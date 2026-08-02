from unittest import TestCase

from pydantic import ValidationError

from backend import models
from backend.ai import director
from backend.ai import entities
from backend.ai import route


def _scene(node_id: str, n: int, title: str) -> "models.Node":
    return models.Node(node_id=node_id, kind=models.NodeKind.SCENE, title=title, data={"n": n})


class ConversationalEditTests(TestCase):
    def test_apply_request_rejects_unknown_change_and_field(self) -> None:
        base = {"project_id": "p1", "target_node_id": "n1"}

        with self.assertRaises(ValidationError):
            models.ApplyEditRequest(**base, change="delete")
        with self.assertRaises(ValidationError):
            models.ApplyEditRequest(**base, change="field", field="title", to="New title")

    def test_apply_rechecks_field_against_target_kind(self) -> None:
        character = models.Node(
            node_id="char_1",
            kind=models.NodeKind.CHARACTER,
            title="Ada",
            data={"id": "ADA", "dna": "A precise, guarded detective."},
        )
        project = models.Project(project_id="p1", nodes=[character])
        request = models.ApplyEditRequest(
            project_id="p1",
            target_node_id="char_1",
            change="field",
            field="action",
            to="Walks into the rain.",
        )

        events = list(director.apply_edit(project, request))

        self.assertEqual(events[0].type, "error")
        self.assertIn("no longer matches", events[0].label)
        self.assertEqual(character.data["dna"], "A precise, guarded detective.")

    def test_apply_rejects_empty_note(self) -> None:
        shot = models.Node(node_id="shot_1", kind=models.NodeKind.SHOT, title="Close-up")
        project = models.Project(project_id="p1", nodes=[shot])
        request = models.ApplyEditRequest(
            project_id="p1",
            target_node_id="shot_1",
            change="note",
            note="   ",
        )

        events = list(director.apply_edit(project, request))

        self.assertEqual(events[0].type, "error")
        self.assertIn("empty", events[0].label)

    def test_unplaceable_note_offers_clarify_anchors(self) -> None:
        # The screenshot case: a note with no signal ("movie") should stop dead-ending and
        # instead ask, offering the opening and the ending as tappable choices.
        project = models.Project(project_id="p1", nodes=[
            _scene("sc_1", 1, "Scene 1: Arrival"),
            _scene("sc_2", 2, "Scene 2: The reckoning"),
            _scene("sc_3", 3, "Scene 3: Departure"),
        ])

        proposal = director.propose_edit(project, "movie", None)

        self.assertFalse(proposal["ok"])
        self.assertNotIn("reason", proposal)
        ids = [o["node_id"] for o in proposal["clarify"]["options"]]
        self.assertEqual(ids, ["sc_1", "sc_3"])

    def test_candidates_surface_a_substring_name_route_misses(self) -> None:
        # route() only matches a name on a word boundary; candidates() is looser, so a note
        # that mentions the character mid-word still gets them offered as a choice.
        character = models.Node(
            node_id="char_1", kind=models.NodeKind.CHARACTER, title="Ada",
            data={"id": "ADA", "dna": "A guarded detective."})
        project = models.Project(project_id="p1", nodes=[
            character, _scene("sc_1", 1, "Scene 1: Arrival")])

        self.assertIsNone(route.route(project, "make it adamantly darker")[0])
        picked = route.candidates(project, "make it adamantly darker")
        self.assertEqual(picked[0].node_id, "char_1")

    def test_follow_up_inherits_last_applied_target(self) -> None:
        shot = models.Node(node_id="shot_1", kind=models.NodeKind.SHOT, title="Close-up")
        project = models.Project(
            project_id="p1",
            nodes=[shot],
            edit_history=[models.EditRecord(
                target_node_id="shot_1", target_title="Close-up", target_kind="shot",
                change="note", summary="Applied a note to Close-up", instruction="Make it warm",
            )],
        )

        proposal = director.propose_edit(project, "make it even warmer", None)

        self.assertTrue(proposal["ok"])
        self.assertEqual(proposal["target"]["node_id"], "shot_1")

    def test_undo_proposal_targets_latest_active_edit(self) -> None:
        character = models.Node(
            node_id="char_1", kind=models.NodeKind.CHARACTER, title="Ada", data={"id": "ADA"}
        )
        record = models.EditRecord(
            target_node_id="char_1", target_title="Ada", target_kind="character",
            change="rename", summary="Renamed Nneka to Ada", before_name="Nneka",
        )
        project = models.Project(project_id="p1", nodes=[character], edit_history=[record])

        proposal = director.propose_edit(project, "undo that", None)

        self.assertEqual(proposal["change"], "undo")
        self.assertEqual(proposal["edit_id"], record.edit_id)

    def test_text_only_edit_can_be_undone_exactly(self) -> None:
        character = models.Node(
            node_id="char_1", kind=models.NodeKind.CHARACTER, title="Ada",
            data={"id": "ADA", "dna": "Reserved and precise."},
        )
        project = models.Project(project_id="p1", nodes=[character])
        apply_request = models.ApplyEditRequest(
            project_id="p1", target_node_id="char_1", change="field", field="dna",
            to="Warm and spontaneous.", note="make her warmer",
        )
        list(director.apply_edit(project, apply_request))
        record = project.edit_history[-1]

        undo_request = models.ApplyEditRequest(
            project_id="p1", target_node_id="char_1", change="undo", edit_id=record.edit_id,
        )
        events = list(director.apply_edit(project, undo_request))

        self.assertEqual(character.data["dna"], "Reserved and precise.")
        self.assertIsNotNone(record.undone_at)
        self.assertEqual(events[-1].type, "done")

    def test_project_view_does_not_expose_undo_snapshots(self) -> None:
        record = models.EditRecord(
            target_node_id="char_1", target_title="Ada", target_kind="character",
            change="field", summary="Changed Ada", before_nodes={"char_1": {"dna": "secret"}},
        )
        project = models.Project(project_id="p1", edit_history=[record])

        view = entities.project_view(project)

        self.assertNotIn("before_nodes", view["edit_history"][0])

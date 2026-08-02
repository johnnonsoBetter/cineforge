"""A frame is built from — and judged against — only the faces actually in it.

The reference sheets are the identity lock, but a lock is only as good as what it is applied
to: conditioning a solo close-up on the whole scene's sheets is exactly how a second person's
face bleeds into a frame meant for one. This pins the per-unit scoping so that regression
can't quietly widen a unit's references back to the scene cast.
"""
import unittest

from backend import models
from backend.ai import director, camera
from backend.ai import story as story_agent
from backend.ai import qc as qc_agent
from backend.models import Node, NodeKind, NodeStatus, Asset


def _node(kind, title, **kw):
    return Node(kind=kind, title=title, status=NodeStatus.READY, **kw)


def _with_asset(node, url):
    node.asset = Asset(kind=node.kind, url=url)
    return node


class ReferenceScopeTest(unittest.TestCase):
    def setUp(self):
        # A two-hander scene with three setups: a two-shot (both), a solo close-up (Simeon),
        # and a detail insert (nobody). Env + both sheets are rendered so they are referenceable.
        story = _node(NodeKind.STORY, "Story", data={"style": "cinematic"})
        env = _with_asset(_node(NodeKind.ENVIRONMENT, "Hall", parent_ids=[story.node_id],
                                data={"id": "HALL", "desc": "a wedding hall"}), "url://plate")
        sim = _with_asset(_node(NodeKind.CHARACTER, "Simeon", parent_ids=[story.node_id],
                                data={"id": "SIMEON", "dna": "a proud man"}), "url://sheet/simeon")
        ush = _with_asset(_node(NodeKind.CHARACTER, "The Usher", parent_ids=[story.node_id],
                                data={"id": "USHER", "dna": "an immovable usher"}), "url://sheet/usher")
        scene = _node(NodeKind.SCENE, "Scene 2",
                      parent_ids=[story.node_id, sim.node_id, ush.node_id, env.node_id],
                      data={"n": 2, "character_ids": ["SIMEON", "USHER"],
                            "environment_id": "HALL", "action": "the checkpoint"})

        def kf(i, cast):
            return _node(NodeKind.KEYFRAME, f"Frame 2.{i}", parent_ids=[scene.node_id],
                         data={"n": 2, "i": i, "setup": "medium",
                               "coverage": {"character_ids": cast, "action": "a beat"}})

        self.kf_two = kf(0, ["SIMEON", "USHER"])
        self.kf_solo = kf(1, ["SIMEON"])
        self.kf_insert = kf(2, [])
        self.project = models.Project(
            project_id="p1",
            nodes=[story, env, sim, ush, scene, self.kf_two, self.kf_solo, self.kf_insert])

    def _sheet_urls(self, keyframe):
        """The character-sheet URLs a keyframe conditions on (the plate filtered out)."""
        sheets = {"url://sheet/simeon", "url://sheet/usher"}
        return [u for u in director._sheet_refs(self.project, keyframe) if u in sheets]

    def test_two_shot_conditions_on_both_sheets(self):
        self.assertCountEqual(self._sheet_urls(self.kf_two),
                              ["url://sheet/simeon", "url://sheet/usher"])

    def test_solo_closeup_conditions_on_one_sheet(self):
        # The whole point: a close-up of Simeon must not be built against the Usher's face.
        self.assertEqual(self._sheet_urls(self.kf_solo), ["url://sheet/simeon"])

    def test_insert_conditions_on_no_sheet(self):
        self.assertEqual(self._sheet_urls(self.kf_insert), [])
        # ...but it still conditions on the plate, so the location stays locked.
        self.assertIn("url://plate", director._sheet_refs(self.project, self.kf_insert))

    def test_built_from_and_judged_on_are_the_same_set(self):
        # The gate must hold a frame to exactly what it was conditioned on.
        built = set(director._sheet_refs(self.project, self.kf_solo))
        judged = {r.url for r in director._target_for(self.project, self.kf_solo).references}
        self.assertEqual(built, judged)

    def test_insert_skips_the_identity_criterion(self):
        target = director._target_for(self.project, self.kf_insert)
        self.assertIn("identity", target.skip_criteria)
        # And a real review would not even ask about identity for it.
        criteria = [c for c in qc_agent.CRITERIA[NodeKind.KEYFRAME]
                    if c not in target.skip_criteria]
        self.assertNotIn("identity", criteria)

    def test_populated_frame_keeps_the_identity_criterion(self):
        self.assertEqual(director._target_for(self.project, self.kf_solo).skip_criteria, ())

    def test_reference_count_is_capped(self):
        # Faces first, plate reserved, total bounded — never an unbounded reference set.
        self.assertLessEqual(len(director._sheet_refs(self.project, self.kf_two)),
                             director.cfg.MAX_REF_IMAGES)


class UnitPromptScopeTest(unittest.TestCase):
    """ensure_prompts composes each unit against only its own cast."""

    def _plan(self):
        return {
            "characters": [
                {"id": "SIMEON", "name": "Simeon",
                 "identity": {"ethnicity": "Nigerian", "gender": "man"}, "wardrobe": "agbada"},
                {"id": "USHER", "name": "The Usher",
                 "identity": {"ethnicity": "Nigerian", "gender": "woman"}, "wardrobe": "gele"}],
            "environments": [{"id": "HALL", "name": "Hall", "desc": "a hall"}],
            "scenes": [{"n": 2, "environment_id": "HALL",
                        "character_ids": ["SIMEON", "USHER"],
                        "coverage": [
                            {"shot": "close-up", "character_ids": ["SIMEON"], "action": "his smile"},
                            {"shot": "insert", "character_ids": [], "action": "a finger on a list"}]}],
        }

    def test_solo_unit_prompt_names_only_its_character(self):
        plan = camera.ensure_prompts(self._plan(), "cinematic")
        solo = plan["scenes"][0]["coverage"][0]["keyframe_prompt"]
        self.assertIn("agbada", solo)       # Simeon's wardrobe is present
        self.assertNotIn("gele", solo)      # the Usher's is not

    def test_insert_unit_prompt_names_nobody(self):
        plan = camera.ensure_prompts(self._plan(), "cinematic")
        insert = plan["scenes"][0]["coverage"][1]["keyframe_prompt"]
        self.assertNotIn("agbada", insert)
        self.assertNotIn("gele", insert)


class NormalizeUnitCastTest(unittest.TestCase):
    """The normalizer resolves a unit's cast against the scene and preserves None vs []."""

    def _units(self, raw_units):
        scene = {"character_ids": ["SIMEON", "USHER"], "shot": "medium shot"}
        return story_agent._normalize_coverage(raw_units, scene)

    def test_absent_cast_inherits_the_scene(self):
        self.assertIsNone(self._units([{"shot": "wide shot"}])[0]["character_ids"])

    def test_explicit_empty_cast_is_preserved(self):
        self.assertEqual(self._units([{"shot": "insert", "character_ids": []}])[0]["character_ids"], [])

    def test_loose_reference_resolves_to_a_scene_id(self):
        # "simeon" (lowercase) must land on SIMEON, and a stranger is dropped.
        got = self._units([{"shot": "close-up", "character_ids": ["simeon", "STRANGER"]}])
        self.assertEqual(got[0]["character_ids"], ["SIMEON"])


if __name__ == "__main__":
    unittest.main()

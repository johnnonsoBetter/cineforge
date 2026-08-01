"""Regenerating a sheet or plate re-renders every frame built on it.

A character/environment is a *look*; a keyframe and its shots inherit that look. When the
look changes, the frames must follow, or the film quietly holds two versions of the same
character at once. This locks in the cascade (and the skip/lock escape hatches) so the
consistency guarantee can't regress into the old stale-only behaviour.
"""
import itertools
import unittest

from backend import models
from backend.ai import director
from backend.models import Node, NodeKind, NodeStatus, Asset
from backend.pipeline import genblaze_client as gb


def _node(kind, title, **kw):
    return Node(kind=kind, title=title, status=NodeStatus.READY, **kw)


def _with_asset(node, url):
    node.asset = Asset(kind=node.kind, url=url)
    return node


class RegenCascadeTest(unittest.TestCase):
    def setUp(self):
        # A one-scene film: env + character → scene → keyframe → shot, each already rendered.
        story = _node(NodeKind.STORY, "Story", data={"style": "noir"})
        env = _with_asset(_node(NodeKind.ENVIRONMENT, "Alley",
                                parent_ids=[story.node_id],
                                data={"id": "env1", "desc": "a wet alley",
                                      "prompt": "a wet alley"}), "url://env/v1")
        char = _with_asset(_node(NodeKind.CHARACTER, "Ada",
                                 parent_ids=[story.node_id],
                                 data={"id": "char1", "dna": "a guarded detective",
                                       "prompt": "Ada sheet"}), "url://char/v1")
        scene = _node(NodeKind.SCENE, "Scene 1",
                      parent_ids=[story.node_id, char.node_id, env.node_id],
                      data={"n": 1, "character_ids": ["char1"], "environment_id": "env1",
                            "action": "Ada waits."})
        kf = _with_asset(_node(NodeKind.KEYFRAME, "Frame 1",
                               parent_ids=[scene.node_id],
                               data={"n": 1, "i": 0, "id": "kf1", "prompt": "frame 1"}),
                         "url://kf/v1")
        shot = _with_asset(_node(NodeKind.SHOT, "Shot 1",
                                 parent_ids=[kf.node_id],
                                 data={"n": 1, "i": 0, "prompt": "shot 1", "coverage": {}}),
                           "url://shot/v1")
        self.project = models.Project(project_id="p1",
                                      nodes=[story, env, char, scene, kf, shot])
        self.env, self.char, self.kf, self.shot = env, char, kf, shot

        # Stub the two paid calls so the test needs no network, keys, or ffmpeg. Each call
        # returns a unique url, which is exactly the signal we assert on — "did this node get
        # a fresh render?" QC then SKIPs (a stub url samples no frames), which counts as
        # accepted, so a stubbed render settles READY just like a real passing one.
        self._seq = itertools.count(1)
        def fake_image(prompt, *, seed="x", ref_urls=None, aspect_ratio="16:9",
                       parent_run_id=None):
            return gb.GenResult(url=f"url://img/{next(self._seq)}",
                                provenance=models.Provenance())
        def fake_video(image_url, prompt, *, duration=8, aspect_ratio="16:9",
                       parent_run_id=None, framing=None, move=None):
            return gb.GenResult(url=f"url://vid/{next(self._seq)}", duration_sec=duration,
                                provenance=models.Provenance())
        self._orig = (gb.generate_image, gb.image_to_video)
        gb.generate_image, gb.image_to_video = fake_image, fake_video

    def tearDown(self):
        gb.generate_image, gb.image_to_video = self._orig

    def test_environment_regen_cascades_to_keyframe_and_shot(self):
        list(director.regenerate_node(self.project, self.env.node_id))

        self.assertNotEqual(self.env.asset.url, "url://env/v1", "plate itself re-rendered")
        self.assertNotEqual(self.kf.asset.url, "url://kf/v1", "keyframe re-rendered off new plate")
        self.assertNotEqual(self.shot.asset.url, "url://shot/v1", "shot re-animated from new frame")
        for n in (self.env, self.kf, self.shot):
            self.assertEqual(n.status, NodeStatus.READY)

    def test_character_regen_cascades_downstream(self):
        list(director.regenerate_node(self.project, self.char.node_id))

        self.assertNotEqual(self.char.asset.url, "url://char/v1")
        self.assertNotEqual(self.kf.asset.url, "url://kf/v1")
        self.assertNotEqual(self.shot.asset.url, "url://shot/v1")

    def test_skipped_keyframe_and_its_shot_are_left_alone(self):
        # Skipping the keyframe keeps it — and, since its clip animates it, the shot too.
        list(director.regenerate_node(self.project, self.env.node_id,
                                      skip=[self.kf.node_id]))

        self.assertNotEqual(self.env.asset.url, "url://env/v1", "plate still re-renders")
        self.assertEqual(self.kf.asset.url, "url://kf/v1", "kept keyframe untouched")
        self.assertEqual(self.shot.asset.url, "url://shot/v1", "kept keyframe's shot untouched")

    def test_locked_keyframe_survives_the_cascade(self):
        self.kf.locked = True
        list(director.regenerate_node(self.project, self.env.node_id))

        self.assertNotEqual(self.env.asset.url, "url://env/v1")
        self.assertEqual(self.kf.asset.url, "url://kf/v1", "a lock is honoured by the cascade")


if __name__ == "__main__":
    unittest.main()

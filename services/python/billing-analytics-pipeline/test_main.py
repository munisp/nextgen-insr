import os
import tempfile
import unittest

os.environ["LAKEHOUSE_DIR"] = tempfile.mkdtemp()

import main


class TestPipeline(unittest.TestCase):
    def test_ingest_persists_to_lakehouse_segment(self):
        res = main.pipeline.ingest([{"type": "invoice.generated", "amount": 100}])
        self.assertEqual(res["ingested"], 1)
        self.assertIn("lakehouse_segment", res["sinks"])
        # opensearch is not running in test: error honestly reported
        self.assertTrue(any("opensearch" in e for e in res["sink_errors"]))

    def test_compaction_merges_segments(self):
        for i in range(3):
            main.pipeline.ingest([{"n": i}])
        res = main.pipeline.lakehouse.compact()
        self.assertTrue(res["compacted"])
        self.assertEqual(res["segments_merged"], 3)
        self.assertGreaterEqual(res["rows"], 3)

    def test_compact_below_threshold_is_honest(self):
        lh = main.LakehouseWriter(main.Path(tempfile.mkdtemp()))
        lh.append([{"a": 1}])
        res = lh.compact()
        self.assertFalse(res["compacted"])

    def test_flush_reports_pending_segments(self):
        res = main.flush()
        self.assertIn("pending_segments", res)

    def test_health(self):
        h = main.health()
        self.assertEqual(h["status"], "ok")


if __name__ == "__main__":
    unittest.main()

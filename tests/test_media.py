import tempfile
import unittest
import zipfile
from pathlib import Path
from editor import media

class MediaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:media.ffmpeg()
        except ValueError:raise unittest.SkipTest('FFmpeg unavailable')

    def test_silent_video_gains_audio_and_trim_is_exact(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'source.mp4';output=root/'normalized.mp4'
            media.run(['-f','lavfi','-i','testsrc2=size=128x96:rate=30','-t','1','-an','-c:v','libx264',source])
            self.assertFalse(media.probe(source)['has_audio'])
            media.normalize_video(source,output,160,96,.5,.2)
            p=media.probe(output)
            self.assertTrue(p['has_audio']);self.assertAlmostEqual(p['duration'],.5,places=1)
            self.assertEqual((p['width'],p['height']),(160,96))
            audio=root/'trim.wav';media.trim_audio(output,audio,.1,.4)
            self.assertAlmostEqual(media.probe(audio)['duration'],.3,places=2)

    def test_sequence_has_no_per_clip_aac_priming_gap(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'source.mp4'
            media.run(['-f','lavfi','-i','testsrc2=size=160x96:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1','-c:v','libx264','-c:a','aac',source])
            p={'width':160,'height':96,'scenes':[{'name':'Scene','segments':[{'name':str(i),'main':'a','duration':.5,'trim_in':0,'prompt':'test','overlap':22} for i in range(3)]}]}
            result=media.export_sequence(p,{'a':{'kind':'video','duration':1,'_path':str(source)}},root/'export','video')
            self.assertAlmostEqual(media.probe(result)['duration'],1.5,places=2)

    def test_export_does_not_silently_skip_missing_segments(self):
        with tempfile.TemporaryDirectory() as tmp:
            p={'scenes':[{'name':'Scene','segments':[{'name':'Missing shot','main':None}]}]}
            with self.assertRaisesRegex(ValueError,'Choose a main video'):
                media.export_sequence(p,{},Path(tmp),'video')

    def test_short_media_fails_before_export(self):
        with tempfile.TemporaryDirectory() as tmp:
            p={'scenes':[{'name':'Scene','segments':[{'name':'Shot','main':'a','duration':4,'trim_in':1}]}]}
            with self.assertRaisesRegex(ValueError,'shorter'):
                media.export_sequence(p,{'a':{'kind':'video','duration':4}},Path(tmp),'video')

if __name__=='__main__':unittest.main()

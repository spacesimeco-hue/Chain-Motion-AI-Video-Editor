import copy
import json
import tempfile
import unittest
from pathlib import Path
from editor.store import Store,project,segment,check_project
from editor.workflows import DEFAULT_MODELS,h3_frames,h3_graph,speech_graph,encode_graph,validate_graph
from editor.comfy import JobRunner
from unittest.mock import patch

class FrameAndGraphTests(unittest.TestCase):
    def test_delivered_duration_never_shrinks(self):
        for seconds in [.25,3,3.5,4,7,11,30]:
            for overlap in [0,22,39,56]:
                frames=h3_frames(seconds,overlap)
                self.assertEqual((frames-5)%17,0)
                self.assertGreaterEqual(frames-overlap,seconds*24)
                self.assertLess(frames-overlap-seconds*24,17.01)

    def test_reference_capacity_and_exact_latent_path(self):
        s=segment();s.update(prompt='Test',connected=True)
        refs=[dict(kind=k,remote=f'{k}{i}.file',has_audio=True) for k,n in [('image',9),('video',3),('audio',3)] for i in range(n)]
        g=h3_graph(s,refs,DEFAULT_MODELS,'unique/take','unique/old/latent_00001.safetensors')
        self.assertEqual(len([k for k in g['reference']['inputs'] if k.startswith('ref_images.')]),9)
        self.assertEqual(len([k for k in g['reference']['inputs'] if k.startswith('ref_videos.')]),3)
        self.assertEqual(len([k for k in g['reference']['inputs'] if k.startswith('ref_audios.')]),3)
        self.assertEqual(g['previous']['inputs']['latent_path'],'unique/old/latent_00001.safetensors')
        self.assertEqual(g['reference']['inputs']['length'],h3_frames(3.5,22))
        self.assertEqual(g['trim']['inputs']['trim_frames'],['context',1])
        with self.assertRaises(ValueError):
            h3_graph(s,refs+[refs[0]],DEFAULT_MODELS,'unique/take')

    def test_no_context_on_first_segment(self):
        g=h3_graph(segment(),[],DEFAULT_MODELS,'first')
        self.assertNotIn('previous',g)
        self.assertEqual(g['reference']['inputs']['length'],h3_frames(3.5))

    def test_speech_locks_prefix_generates_tail_and_trims_output(self):
        spec=dict(prompt='Hello',duration=4,reference_duration=1.5,seed=42)
        g=speech_graph(spec,'ref.png','ref.wav',DEFAULT_MODELS,'speech')
        self.assertEqual(g['size']['inputs']['value'],32)
        self.assertEqual(g['full_av']['inputs']['audio_latent'],['empty_audio',0])
        self.assertEqual(g['av']['inputs']['video_latent'],['full_av',0])
        self.assertEqual(g['av']['inputs']['audio_latent'],['audio_mask',0])
        self.assertEqual(g['mask']['inputs']['value'],0)
        self.assertEqual(g['trim_prefix_audio']['inputs']['start_index'],1.5)
        self.assertEqual(g['trim_prefix_audio']['inputs']['duration'],2.5)
        self.assertEqual(g['trim_prefix_video']['inputs']['batch_index'],36)
        self.assertEqual(g['trim_prefix_video']['inputs']['length'],60)
        self.assertNotIn('identity',g)
        with self.assertRaisesRegex(ValueError,'longer'):
            speech_graph({**spec,'duration':1},'ref.png','ref.wav',DEFAULT_MODELS,'speech')

    def test_graph_links_exist(self):
        for g in [h3_graph(segment(),[],DEFAULT_MODELS,'x'),encode_graph('video.mp4',DEFAULT_MODELS,'x'),speech_graph(dict(prompt='x',duration=3,seed=1,reference_duration=1.5),'x.png','x.wav',DEFAULT_MODELS,'x')]:
            for node in g.values():
                for value in node['inputs'].values():
                    if isinstance(value,list):self.assertIn(value[0],g)

class PersistenceTests(unittest.TestCase):
    def test_restart_does_not_resubmit_uncertain_jobs(self):
        with tempfile.TemporaryDirectory() as tmp:
            s=Store(tmp)
            s.data['jobs']=[dict(id='a',status='submitting'),dict(id='b',status='running',prompt_id='known')]
            s.save(); recovered=Store(tmp)
            self.assertEqual(recovered.data['jobs'][0]['status'],'failed')
            self.assertEqual(recovered.data['jobs'][1]['status'],'recovering')

    def test_scene_reference_limits(self):
        p=project();sc=p['scenes'][0];sc['refs']=[str(i) for i in range(9)]
        assets={str(i):{'kind':'image'} for i in range(10)}
        check_project(p,assets)
        sc['segments'][0]['refs']=['9']
        with self.assertRaisesRegex(ValueError,'exceeds 9'):
            check_project(p,assets)
        sc['segments'][0]['refs']=['0']
        check_project(p,assets)

    def test_path_escape_blocked(self):
        with tempfile.TemporaryDirectory() as tmp:
            s=Store(tmp)
            with self.assertRaises(ValueError):s.asset_path({'file':'../secret'})

class CancellationTests(unittest.TestCase):
    def test_cancel_never_interrupts_other_prompt(self):
        with tempfile.TemporaryDirectory() as tmp:
            s=Store(tmp);s.data['jobs']=[dict(id='mine',prompt_id='p1',status='running',comfy_url='http://localhost:8188')]
            calls=[]
            def req(self,path,body=None,**kw):
                calls.append((path,body));return {'queue_running':[[0,'other']]} if path=='/queue' and body is None else {}
            with patch('editor.comfy.Comfy.request',req):JobRunner(s,None).cancel('mine')
            self.assertNotIn('/interrupt',[x[0] for x in calls])
            self.assertEqual(calls[0],('/queue',{'delete':['p1']}))

    def test_cancel_local_queue_no_network(self):
        with tempfile.TemporaryDirectory() as tmp:
            s=Store(tmp);s.data['jobs']=[dict(id='mine',status='queued')]
            with patch('editor.comfy.Comfy.request') as req:JobRunner(s,None).cancel('mine');req.assert_not_called()
            self.assertEqual(s.data['jobs'][0]['status'],'cancelled')

if __name__=='__main__':unittest.main()

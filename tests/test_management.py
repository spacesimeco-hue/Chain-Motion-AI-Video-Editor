import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch,Mock
import requests
from fastapi import UploadFile
from editor.comfy import Comfy
from editor.store import Store

class ManagementTests(unittest.TestCase):
    def test_cancel_endpoints_accept_empty_success(self):
        response=Mock(ok=True,content=b'',status_code=200)
        with patch('editor.comfy.requests.post',return_value=response):
            self.assertEqual(Comfy('http://localhost:8188').request('/interrupt',{}),{})
            response.json.assert_not_called()

    def test_invalid_json_is_not_reported_as_network_failure(self):
        response=Mock(ok=True,content=b'bad',status_code=200)
        response.json.side_effect=ValueError('bad json')
        with patch('editor.comfy.requests.get',return_value=response):
            with self.assertRaisesRegex(ValueError,'returned invalid JSON'):
                Comfy('http://localhost:8188').request('/queue')

    def test_portable_project_round_trip(self):
        from editor import server
        with tempfile.TemporaryDirectory() as tmp:
            store=Store(tmp)
            p=next(iter(store.data['projects'].values()))
            media=Path(tmp)/'assets'/'test.mp4';media.write_bytes(b'test-media')
            store.data['assets']['clip']=dict(id='clip',kind='video',name='clip',file='assets/test.mp4',duration=4)
            p['scenes'][0]['segments'][0].update(main='clip',takes=['clip'])
            with patch.object(server,'store',store):
                exported=server.export_project(p['id'])
                with open(exported.path,'rb') as f:
                    imported=server.import_project(UploadFile(file=f,filename='test.zip'))
                self.assertNotEqual(p['id'],imported['id'])
                new=imported['scenes'][0]['segments'][0]['main']
                self.assertNotEqual(new,'clip')
                self.assertEqual(store.asset_path(store.data['assets'][new]).read_bytes(),b'test-media')
                server.delete_project(imported['id'])
                self.assertNotIn(imported['id'],store.data['projects'])
                self.assertIn(new,store.data['assets'])

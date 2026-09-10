"""Run with python run.py. Data stays next to the app unless FRAMEFORGE_DATA is set."""
import argparse
import os
import uvicorn

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description='Frameforge local video editor')
    parser.add_argument('--port',type=int,default=8787)
    parser.add_argument('--host',default='127.0.0.1')
    parser.add_argument('--data',help='Portable library directory')
    args=parser.parse_args()
    if args.data:
        os.environ['FRAMEFORGE_DATA']=args.data
    print(f'Frameforge: http://{args.host}:{args.port}')
    uvicorn.run('editor.server:app',host=args.host,port=args.port)

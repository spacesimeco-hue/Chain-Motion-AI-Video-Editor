"""Start Frameforge locally, or share it on a trusted LAN with --lan."""
import argparse
import ipaddress
import os
import socket
import uvicorn


def lan_addresses():
    addresses = set()
    try:
        addresses.update(info[4][0] for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET))
    except OSError:
        pass
    # Resolve the default local route without sending traffic or requiring internet access.
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as route:
            route.connect(('192.168.0.1', 9))
            addresses.add(route.getsockname()[0])
    except OSError:
        pass
    return sorted(a for a in addresses if not ipaddress.ip_address(a).is_loopback and not ipaddress.ip_address(a).is_unspecified)


def main():
    parser = argparse.ArgumentParser(description='Frameforge local video editor')
    parser.add_argument('--port', type=int, default=8787)
    binding = parser.add_mutually_exclusive_group()
    binding.add_argument('--host', help='Bind to a specific interface (default: 127.0.0.1)')
    binding.add_argument('--lan', action='store_true', help='Share the editor on your local network')
    parser.add_argument('--data', help='Portable library directory')
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error('Port must be between 1 and 65535.')
    if args.data:
        os.environ['FRAMEFORGE_DATA'] = args.data
    host = '0.0.0.0' if args.lan else (args.host or '127.0.0.1')
    if host == '0.0.0.0':
        print(f'On this computer: http://127.0.0.1:{args.port}', flush=True)
        for address in lan_addresses():
            print(f'On your LAN: http://{address}:{args.port}', flush=True)
        print(f'Other devices: open http://<this computer\'s LAN IP>:{args.port}. Allow TCP port {args.port} on your private-network firewall if needed.', flush=True)
        print('LAN access has no sign-in: use a trusted network. Connected users share this library and generation queue.', flush=True)
    else:
        display_host = f'[{host}]' if ':' in host else host
        print(f'Frameforge: http://{display_host}:{args.port}', flush=True)
    uvicorn.run('editor.server:app', host=host, port=args.port)


if __name__ == '__main__':
    main()

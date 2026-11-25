"""Threaded static server for local checks (offline, no dependencies)."""

import errno
import functools
import http.server
import os
import socketserver
import sys
import webbrowser


class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        if os.environ.get("SERVE_VERBOSE"):
            super().log_message(fmt, *args)


def launch():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    handler = functools.partial(Handler, directory=root)
    for port in range(8000, 8021):
        try:
            server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
        except OSError as error:
            if error.errno not in (errno.EADDRINUSE, 10048):
                raise
            continue
        with server:
            url = f"http://127.0.0.1:{port}/"
            print(f"Dandelion Demo: {url}  (Ctrl+C to stop)", flush=True)
            if os.environ.get("NO_OPEN") != "1":
                webbrowser.open(url)
            try:
                server.serve_forever()
            except KeyboardInterrupt:
                pass
        return
    raise SystemExit("Ports 8000-8020 are busy.")


def main():
    if sys.argv[1:] == ["--launch"]:
        launch()
        return
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    root = sys.argv[2] if len(sys.argv) > 2 else "."
    handler = functools.partial(Handler, directory=root)
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("127.0.0.1", port), handler) as httpd:
        print(f"serving {os.path.abspath(root)} on http://127.0.0.1:{port}")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
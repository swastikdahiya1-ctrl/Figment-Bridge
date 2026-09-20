import http.server
import socketserver
import json
import re
import os

PORT = 8080
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def do_POST(self):
        if self.path == '/api/save-settings':
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            
            try:
                data = json.loads(post_data.decode('utf-8'))
                top_gap = int(data.get('topGap', 90))
                
                # 1. Update styles.css
                styles_path = os.path.join(BASE_DIR, 'styles.css')
                if os.path.exists(styles_path):
                    with open(styles_path, 'r', encoding='utf-8') as f:
                        css = f.read()
                    # Replace var(--hero-top-gap, ...px)
                    new_css = re.sub(
                        r'padding:\s*var\(--hero-top-gap,\s*\d+px\)',
                        f'padding: var(--hero-top-gap, {top_gap}px)',
                        css
                    )
                    with open(styles_path, 'w', encoding='utf-8') as f:
                        f.write(new_css)

                # 2. Update index.html
                html_path = os.path.join(BASE_DIR, 'index.html')
                if os.path.exists(html_path):
                    with open(html_path, 'r', encoding='utf-8') as f:
                        html = f.read()
                    # Replace slider value in tool-top-gap-slider
                    new_html = re.sub(
                        r'(<input\b[^>]*\bid="tool-top-gap-slider"[^>]*>)',
                        lambda m: re.sub(r'value="\d+"', f'value="{top_gap}"', m.group(0)),
                        html
                    )
                    # Replace value display
                    new_html = re.sub(
                        r'(<span[^>]*id="tool-top-gap-val"[^>]*>)\d+px(</span>)',
                        rf'\g<1>{top_gap}px\g<2>',
                        new_html
                    )
                    with open(html_path, 'w', encoding='utf-8') as f:
                        f.write(new_html)

                # 3. Update app.js
                js_path = os.path.join(BASE_DIR, 'app.js')
                if os.path.exists(js_path):
                    with open(js_path, 'r', encoding='utf-8') as f:
                        js = f.read()
                    new_js = re.sub(
                        r'const\s+DEFAULT_GAP\s*=\s*\d+;',
                        f'const DEFAULT_GAP = {top_gap};',
                        js
                    )
                    with open(js_path, 'w', encoding='utf-8') as f:
                        f.write(new_js)

                response = json.dumps({'success': True, 'topGap': top_gap}).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(response)))
                self.end_headers()
                self.wfile.write(response)
                print(f"[Tool HUD] Saved default gap {top_gap}px directly into code files.")
                return

            except Exception as e:
                err_msg = json.dumps({'success': False, 'error': str(e)}).encode('utf-8')
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(err_msg)))
                self.end_headers()
                self.wfile.write(err_msg)
                return

        self.send_error(404, "Endpoint not found")

if __name__ == '__main__':
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), CustomHandler) as httpd:
        print(f"Server started at http://127.0.0.1:{PORT}")
        httpd.serve_forever()

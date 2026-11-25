"""Open the local catalog without a server and follow its navigation."""
from pathlib import Path
from cdp import Chrome

HOME = (Path(__file__).resolve().parents[2] / 'index.html').as_uri()
SCENES = [
    ('prototype/index.html', 'window.__dandy?.field'),
    ('game.html', 'window.__dandy?.abilities'),
    ('dev.html', 'window.__dandy?.devConsole'),
    ('labs/vegetation.html', 'window.__veg'),
    ('labs/landmarks.html', 'window.__landmarks'),
    ('labs/distant.html', 'window.__dandy?.mode === "distant"'),
    ('labs/valley.html', 'window.__valley'),
]

def click(browser, selector):
    point = browser.eval(f"""(()=>{{
      const el=document.querySelector({selector!r});
      el.scrollIntoView({{block:'center'}});
      const r=el.getBoundingClientRect();
      return [r.x+r.width/2, r.y+r.height/2];
    }})()""")
    browser.tap(*point)

def main():
    browser = Chrome(760,480,light=True,nice=15).start()
    try:
        browser.connect_existing()
        browser.ws.settimeout(120)
        browser.navigate(HOME,False)
        for path, ready in SCENES:
            browser.wait_for("!!document.querySelector('.hero')")
            # Freeze previews after one frame on the software GPU. Keep the
            # original link target and exercise the actual click and return.
            selector = f'a[href="{path}"]'
            link = browser.eval(f"document.querySelector({selector!r}).href")
            if path != 'dev.html':
                browser.eval(f"document.querySelector({selector!r}).href = {link!r} + '?still=.05&quality=low&post=0'")
                selector = f'a[href^="{link}"]'
            click(browser, selector)
            browser.wait_for(f'!!({ready})', timeout=90)
            if path.startswith('prototype/'):
                x,y = browser.eval('[innerWidth * .5, innerHeight * .8]')
                browser.tap_nowait(x,y)
                browser.wait_for('window.__dandy.field.count === 1')
            click(browser, '.demo-home')
            browser.wait_for("!!document.querySelector('.hero')")
            print('PASS', path, flush=True)
        click(browser, 'a[href="docs/presentation.html"]')
        browser.wait_for("!!document.querySelector('.slide.is-active')")
        click(browser, '#outlineToggle')
        click(browser, '#outlineList li:nth-child(3) button')
        assert browser.eval('location.hash') == '#3'
        click(browser, '#notesToggle')
        for _ in range(2):
            browser.send('Input.dispatchKeyEvent', {'type':'keyDown','key':'Escape','code':'Escape','windowsVirtualKeyCode':27})
            browser.send('Input.dispatchKeyEvent', {'type':'keyUp','key':'Escape','code':'Escape','windowsVirtualKeyCode':27})
        browser.wait_for("!!document.querySelector('.hero')")
        click(browser, 'a[href="docs/presentation.html"]')
        browser.wait_for("!!document.querySelector('.slide.is-active')")
        click(browser, '.demo-home')
        browser.wait_for("!!document.querySelector('.hero')")
        print('PASS presentation navigation and both exits')
    finally:
        browser.close()

if __name__ == '__main__':
    main()

"""Walk, plant and carry seeds using the normal keyboard and canvas inputs."""

def hold_forward(chrome, condition):
    key = {"code": "KeyW", "key": "w", "windowsVirtualKeyCode": 87}
    chrome.send("Input.dispatchKeyEvent", {"type": "keyDown", **key})
    try:
        chrome.wait_for(condition, timeout=35, interval=.05)
    finally:
        chrome.send("Input.dispatchKeyEvent", {"type": "keyUp", **key})


def plant_at_tree(chrome):
    hold_forward(chrome, "window.__dandy.abilities.state.settings.walked")
    hold_forward(chrome, "window.__dandy.store.ui.windGuide?.text === '点这里种花'")
    point = chrome.eval("({...window.__dandy.store.ui.windGuide})")
    chrome.tap(point["x"], point["y"])
    chrome.wait_for("window.__dandy.field.count === 1 && window.__dandy.store.ui.memories.length > 0")
    return point


def send_tree_seed(chrome):
    if not chrome.eval("window.__dandy.field.count"):
        plant_at_tree(chrome)
    chrome.wait_for("window.__dandy.field.plants[0]?.canBlow")
    hold_forward(chrome, "window.__dandy.abilities.has('camera')")

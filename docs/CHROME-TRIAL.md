# Chrome DevTools MCP：本地购物车点击试验

**结论（2026-11-25）：跑通。** 官方 MCP 通过 stdio 启动隔离的 headless Chrome，打开只含一个按钮和一个计数的本地页面。一次 `click` 后，重新读取的无障碍快照显示 `Cart: 1 item`。用同一份快照断言 `Cart: 2 items`，得到预期失败。本试验验证页面可见文案，不验证像素、真实订单或 Figma 集成。

## 环境与边界

- macOS arm64，Darwin 27.2.0；已安装的 Google Chrome `158.0.8127.36`；Node `v24.13.1`；Python `3.14.7`。
- PATH、Node 全局目录和已有 npx 缓存中未找到 MCP。通过公共 registry 核对包的仓库为 `https://github.com/ChromeDevTools/chrome-devtools-mcp`，随后在临时目录用 npx 运行固定版本 `1.14.0`。包进入用户缓存，未安装到工程。
- MCP 自行启动 Chrome，使用 `--headless --isolated` 临时 profile，不连接日常浏览器。页面无外部资源、账号、凭据或业务数据。客户端只用标准库，通过 stdin/stdout 交换逐行 JSON-RPC；关闭了 MCP 的脚本求值、使用统计和 CrUX。

## 实测证据

以下为成功运行的输出节选。两次 `take_snapshot` 之间只有一次 `click`，目标 UID 取自第一份快照。

```text
2025-11-25 {'name': 'chrome_devtools', 'title': 'Chrome DevTools MCP server', 'version': '1.14.0'}
2: Cart trial (file:///private/tmp/chrome-trial.UVCVv2J6/index.html) [selected]
  uid=1_1 button "Add to cart"
  uid=1_2 status atomic live="polite" relevant="additions text"
    uid=1_3 "Cart: 0 items"

click Successfully clicked on the element
  uid=1_1 button "Add to cart" focusable focused
  uid=1_2 status atomic live="polite" relevant="additions text"
    uid=2_0 "Cart: 1 item"

PASS ['Cart: 1 item']
XFAIL expected Cart: 2 items; actual ['Cart: 1 item']
```

首行的 `2025-11-25` 是协商的 MCP 协议版本，不是试验日期。首次尝试因解析器要求文本行带 `StaticText` 标签，在点击前停止；该版本实际返回 `uid=… "Cart: 0 items"`。按实际格式修正后，从新会话重跑，退出码为 `0`。负对照仅捕获故意写错的断言，不吞掉正向断言或工具错误。

## 复现

在已安装稳定版 Chrome、Node/npx 和 Python 3 的机器上运行以下代码块。首次获取固定版本需要访问公共 registry。路径和 UID 会随运行变化。不要使用 Python 的 `-O`，它会关闭断言。

```sh
trial=$(mktemp -d) && cd "$trial" || exit 1
cat > index.html <<'HTML'
<!doctype html><meta charset="utf-8"><title>Cart trial</title>
<button onclick="document.querySelector('output').textContent='Cart: 1 item'">Add to cart</button>
<output>Cart: 0 items</output>
HTML

python3 - <<'PY'
import itertools, json, os, re, subprocess
from pathlib import Path

args = ["npx", "--yes", "chrome-devtools-mcp@1.14.0", "--headless",
        "--isolated", "--no-page-id-routing", "--no-javascript-evaluation",
        "--no-usage-statistics", "--no-performance-crux"]
p = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                     text=True, env=dict(os.environ, npm_config_registry="https://registry.npmjs.org"))
ids = itertools.count(1)

def rpc(method, params, notify=False):
    msg = dict(jsonrpc="2.0", method=method, params=params)
    if not notify:
        msg["id"] = next(ids)
    print(json.dumps(msg), file=p.stdin, flush=True)
    if not notify:
        for line in p.stdout:
            reply = json.loads(line)
            if reply.get("id") == msg["id"]:
                return reply["result"]
        raise RuntimeError("MCP stdout closed")

def tool(name, **args):
    r = rpc("tools/call", dict(name=name, arguments=args))
    text = "\n".join(c["text"] for c in r["content"] if c["type"] == "text")
    print(name, text)
    if r.get("isError"):
        raise RuntimeError(text)
    return text

try:
    hello = rpc("initialize", dict(protocolVersion="2025-11-25", capabilities={},
                clientInfo=dict(name="cart-trial", version="1")))
    print(hello["protocolVersion"], hello["serverInfo"])
    rpc("notifications/initialized", {}, True)
    tool("new_page", url=Path("index.html").resolve().as_uri())
    before = tool("take_snapshot")
    def count(snapshot):
        return re.findall(r'^\s*uid=\S+ "(Cart: [^"]+)"$', snapshot, re.M)
    assert count(before) == ["Cart: 0 items"]
    uid = re.search(r'uid=(\S+) button "Add to cart"', before)[1]
    tool("click", uid=uid)
    observed = count(tool("take_snapshot"))
    assert observed == ["Cart: 1 item"], observed
    print("PASS", observed)
    try:
        assert observed == ["Cart: 2 items"], observed
    except AssertionError as e:
        print("XFAIL expected Cart: 2 items; actual", e)
    else:
        raise RuntimeError("negative control unexpectedly passed")
finally:
    p.stdin.close()
    p.wait(timeout=20)
PY
```

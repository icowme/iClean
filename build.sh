#!/usr/bin/env bash
# ============================================================================
#  iClean 打包脚本
# ============================================================================
#  用法：bash build.sh     （只出 zip，不生成 crx）
#
#  流程：复制源码到临时目录 → 压缩自研 JS → 输出 zip
#
#  重要：源码目录不会被修改。压缩只发生在临时目录里，产物里的 JS 是同名
#        压缩版，因此 popup.html 等处的引用无需改动。以后改代码照常改
#        src/ 下的可读源码即可。
#
#  只压缩自研文件；第三方模块（FlowMouse GPL v3、Open Bookmarks MIT）
#  保持源码可读，以符合各自的许可证要求。
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PARENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$SCRIPT_DIR"

NODE="/Users/dgc/.workbuddy-ai/binaries/node/versions/22.22.2-3/bin/node"
TERSER="/Users/dgc/.workbuddy-ai/binaries/node/workspace/node_modules/.bin/terser"

VERSION=$("$NODE" -p "require('./manifest.json').version")
# 产物用绝对路径：zip 命令会在子 shell 里 cd，相对路径会写错位置
OUT_ZIP="$PARENT_DIR/iclean-v${VERSION}.zip"
BUILD=$(mktemp -d)
trap 'rm -rf "$BUILD"' EXIT

echo "→ 打包 iClean v${VERSION}"

# ── 1) 复制源码到临时目录（排除版本库、文档、脚本）────────────────────────
rsync -a \
  --exclude='.git' --exclude='docs' --exclude='gen_icons.py' \
  --exclude='build.sh' --exclude='node_modules' --exclude='.gitignore' \
  --exclude='*.DS_Store' \
  ./ "$BUILD/chrome-cleaner/"

# ── 2) 压缩自研 JS（第三方模块不动）──────────────────────────────────────
SELF_JS=(
  "src/popup/popup.js"
  "src/background/background.js"
  "src/shared/cleaner.js"
  "src/shared/dataTypes.js"
  "src/shared/store.js"
  "src/shared/gestureList.js"
  "src/options/options.js"
  "js/auto-copy.js"
  "js/show-password.js"
)

BEFORE=0
AFTER=0
for f in "${SELF_JS[@]}"; do
  p="$BUILD/chrome-cleaner/$f"
  [ -f "$p" ] || continue
  b=$(wc -c < "$p" | tr -d ' ')
  "$NODE" "$TERSER" "$p" -c -m --comments '/^!/' -o "$p"
  a=$(wc -c < "$p" | tr -d ' ')
  BEFORE=$((BEFORE + b))
  AFTER=$((AFTER + a))
done
if [ "$BEFORE" -gt 0 ]; then
  echo "→ 自研 JS 压缩：$((BEFORE / 1024)) KB → $((AFTER / 1024)) KB（版权注释保留）"
fi

# ── 3) 输出 zip ──────────────────────────────────────────────────────────
rm -f "$OUT_ZIP"
(cd "$BUILD/chrome-cleaner" && zip -rq "$OUT_ZIP" .)
echo "✓ $(basename "$OUT_ZIP")"


echo
ls -lh "$OUT_ZIP" 2>/dev/null | awk '{print "  zip  " $5}'
echo "→ 源码目录未改动，可继续编辑 src/ 下的可读源码"

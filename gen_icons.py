#!/usr/bin/env python3
"""手写距离场方式生成 Chrome 扩展图标 PNG（16/32/48/128）"""
import zlib, struct, math, os

GRAD_TOP = (0x4F, 0x7C, 0xFF)
GRAD_BOT = (0x7A, 0x5C, 0xFF)

def lerp(a, b, t):
    return a + (b - a) * t

def lerp3(c1, c2, t):
    return (lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t))

def clamp(v, lo, hi):
    return max(lo, min(hi, v))

def sd_segment(px, py, x1, y1, x2, y2):
    """点到线段的距离"""
    dx = x2 - x1; dy = y2 - y1
    l2 = dx*dx + dy*dy
    if l2 == 0.0:
        return math.hypot(px - x1, py - y1)
    t = clamp(((px - x1) * dx + (py - y1) * dy) / l2, 0.0, 1.0)
    return math.hypot(px - (x1 + t*dx), py - (y1 + t*dy))

def sd_rounded_rect(px, py, cx, cy, w, h, r):
    dx = abs(px - cx) - (w/2 - r)
    dy = abs(py - cy) - (h/2 - r)
    return math.hypot(max(dx, 0.0), max(dy, 0.0)) + min(max(dx, dy), 0.0) - r

def draw_icon(size, ss=4):
    """生成 RGBA 图像（size 为输出尺寸，ss 为超采样倍数）"""
    S = size * ss
    img = []
    for y in range(S):
        row = []
        cy = (y + 0.5) / S
        for x in range(S):
            cx = (x + 0.5) / S
            # 背景：圆角矩形，渐变
            bg_d = sd_rounded_rect(cx, cy, 0.5, 0.5, 1.0, 1.0, 0.22)
            bg_a = clamp(-bg_d * (S * 0.7) + 0.5, 0.0, 1.0)
            bg_col = lerp3(GRAD_TOP, GRAD_BOT, cy)

            # 前景：三条斜线（代表清理/擦除）
            lw = 0.055  # 线宽（归一化）
            lines = [
                (0.30, 0.62, 0.72, 0.42),
                (0.30, 0.50, 0.66, 0.34),
                (0.30, 0.38, 0.58, 0.28),
            ]
            fg_a = 0.0
            for a in lines:
                d = sd_segment(cx, cy, a[0], a[1], a[2], a[3])
                cov = clamp((lw - d) * (S * 0.7) + 0.5, 0.0, 1.0)
                fg_a = max(fg_a, cov)

            # 合成（注意：alpha 与 RGB 一样使用 0-255 色域）
            r = lerp(bg_col[0], 0xFF, fg_a)
            g = lerp(bg_col[1], 0xFF, fg_a)
            b = lerp(bg_col[2], 0xFF, fg_a)
            a = lerp(bg_a, 1.0, fg_a) * 255.0
            row.append((r, g, b, a))
        img.append(row)

    # 4x 超采样降采样到目标尺寸
    out = []
    for oy in range(size):
        for ox in range(size):
            sr, sg, sb, sa = 0.0, 0.0, 0.0, 0.0
            for dy in range(ss):
                for dx in range(ss):
                    c = img[oy*ss+dy][ox*ss+dx]
                    sr += c[0]; sg += c[1]; sb += c[2]; sa += c[3]
            n = ss*ss
            out.append((int(sr/n), int(sg/n), int(sb/n), int(sa/n)))
    return out

def write_png(pixels, size, path):
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter none
        for x in range(size):
            r, g, b, a = pixels[y*size+x]
            raw.extend([r, g, b, a])
    compressed = zlib.compress(bytes(raw))
    def chunk(typ, data):
        c = struct.pack('>I', len(data)) + typ + data
        crc = struct.pack('>I', zlib.crc32(c[4:]) & 0xffffffff)
        return c + crc
    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    data = b''.join([
        chunk(b'IHDR', ihdr),
        chunk(b'IDAT', compressed),
        chunk(b'IEND', b'')
    ])
    with open(path, 'wb') as f:
        f.write(sig + data)

base = os.path.dirname(os.path.abspath(__file__))
outdir = os.path.join(base, 'icons')
os.makedirs(outdir, exist_ok=True)

for sz in [16, 32, 48, 128]:
    px = draw_icon(sz, ss=4)
    write_png(px, sz, os.path.join(outdir, 'icon{}.png'.format(sz)))
    print('generated icon{}.png'.format(sz))

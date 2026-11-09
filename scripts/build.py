# -*- coding: utf-8 -*-
"""把 data/ 下的题库构建成单文件 HTML。

    python scripts/build.py                      # 默认读 ./data，输出 ./dist/index.html
    python scripts/build.py --no-ai              # 不注入 AI 助教
    python scripts/build.py --out 复习/index.html
    python scripts/build.py --open               # 构建完自动用浏览器打开

数据约定见 references/data-schema.md。
"""
import argparse
import hashlib
import json
import sys
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"

sys.path.insert(0, str(Path(__file__).resolve().parent))
from validate import load_course, validate  # noqa: E402


def make_mark(title: str) -> str:
    t = title.strip()
    if not t:
        return "Q"
    if t[0].isascii():
        return t[0].upper()
    return t[0]


def default_storage_key(title: str) -> str:
    return "quiz-review-" + hashlib.md5(title.encode("utf-8")).hexdigest()[:8]


def build(payload_data, course, ai_enabled: bool, out_path: Path, template_path: Path):
    tpl = template_path.read_text(encoding="utf-8")

    title = str(course.get("title", "")).strip()
    mark = str(course.get("mark", "")).strip() or make_mark(title)
    storage_key = str(course.get("storageKey", "")).strip()
    storage_key = "quiz-review-" + storage_key if storage_key else default_storage_key(title)
    count = len(payload_data["questions"])

    data_json = json.dumps(payload_data, ensure_ascii=False, separators=(",", ":"))
    data_json = data_json.replace("</", "<\\/")

    head_extra, body_extra = "", ""
    if ai_enabled:
        css = (ASSETS / "tutor.css").read_text(encoding="utf-8")
        js = (ASSETS / "tutor.js").read_text(encoding="utf-8")
        head_extra = "<style>\n" + css + "\n</style>"
        cfg = json.dumps({"course": title}, ensure_ascii=False)
        body_extra = (
            "<script>window.QUIZ_AI = " + cfg + ";</script>\n"
            "<script>\n" + js + "\n</script>"
        )

    html = tpl
    for key, val in (
        ("__COURSE__", title),
        ("__MARK__", mark),
        ("__COUNT__", str(count)),
        ("__STORAGE_KEY__", storage_key),
        ("__HEAD_EXTRA__", head_extra),
        ("__BODY_EXTRA__", body_extra),
        ("__DATA__", data_json),
    ):
        html = html.replace(key, val)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(html, encoding="utf-8")
    return out_path, count


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    ap = argparse.ArgumentParser(description="构建课程题库 HTML")
    ap.add_argument("--data", default="data", help="数据目录，默认 ./data")
    ap.add_argument("--out", default="dist/index.html", help="输出文件，默认 ./dist/index.html")
    ap.add_argument("--template", default=str(ASSETS / "template.html"), help="模板路径")
    group = ap.add_mutually_exclusive_group()
    group.add_argument("--ai", dest="ai", action="store_true", help="强制启用 AI 助教")
    group.add_argument("--no-ai", dest="ai", action="store_false", help="强制关闭 AI 助教")
    ap.set_defaults(ai=None)
    ap.add_argument("--force", action="store_true", help="有校验错误仍然构建")
    ap.add_argument("--open", action="store_true", help="构建后用浏览器打开")
    args = ap.parse_args()

    data_dir = Path(args.data).resolve()
    try:
        course, packs = load_course(data_dir)
    except Exception as e:
        print(f"[×] {e}")
        return 1

    result = validate(course, packs)
    for w in result["warnings"]:
        print(f"[!] {w}")
    for e in result["errors"]:
        print(f"[×] {e}")
    if result["errors"] and not args.force:
        print(f"\n校验未通过（{len(result['errors'])} 个错误），已停止。修完再构建，或加 --force 强制输出。")
        return 1

    merged_packs, questions = [], []
    for _, pack in packs:
        pid = str(pack["id"]).strip()
        merged_packs.append({
            "id": pid,
            "head": str(pack.get("head", pid)).strip(),
            "name": str(pack["name"]).strip(),
            "subtitle": str(pack.get("subtitle", "")).strip(),
            "notes": pack.get("notes", ""),
        })
        for q in pack["questions"]:
            item = dict(q)
            item["pack"] = pid
            questions.append(item)

    ai_enabled = args.ai if args.ai is not None else bool(course.get("aiTutor", True))
    out_path = Path(args.out).resolve()
    template_path = Path(args.template).resolve()
    out, count = build({"packs": merged_packs, "questions": questions},
                       course, ai_enabled, out_path, template_path)

    size_kb = out.stat().st_size / 1024
    print(f"\n[√] 已生成 {out}")
    print(f"    {count} 题 / {len(merged_packs)} 个板块 / {size_kb:.0f} KB / AI 助教：{'启用' if ai_enabled else '关闭'}")
    sk = str(course.get("storageKey", "")).strip()
    print(f"    进度存储键：{'quiz-review-' + sk if sk else default_storage_key(str(course.get('title', '')))}")

    if args.open:
        webbrowser.open(out.as_uri())
    return 0


if __name__ == "__main__":
    sys.exit(main())

# -*- coding: utf-8 -*-
"""题库校验。可作为模块被 build.py 调用，也可单独运行：

    python scripts/validate.py --data data
"""
import argparse
import json
import re
import sys
from pathlib import Path


def load_course(data_dir: Path):
    course_file = data_dir / "course.json"
    if not course_file.exists():
        raise FileNotFoundError(f"缺少 {course_file}")
    course = json.loads(course_file.read_text(encoding="utf-8"))
    pack_files = sorted((data_dir / "packs").glob("*.json"))
    if not pack_files:
        raise FileNotFoundError(f"{data_dir / 'packs'} 里没有 .json 文件")
    packs = []
    for f in pack_files:
        try:
            packs.append((f.name, json.loads(f.read_text(encoding="utf-8"))))
        except json.JSONDecodeError as e:
            raise ValueError(f"{f.name} JSON 解析失败：{e}") from e
    return course, packs


NUM_RE = re.compile(r"^[+\-]?(\d+(\.\d*)?|\.\d+)([eE][+\-]?\d+)?$")
FRAC_RE = re.compile(r"^[+\-]?\d+(\.\d+)?/[+\-]?\d+(\.\d+)?$")
PLACEHOLDER_RE = re.compile(r"__[A-Z_]+__")
TYPES = {"choice", "judge", "fill", "subjective"}


def is_number(s):
    s = str(s).strip()
    return bool(NUM_RE.match(s) or FRAC_RE.match(s))


def check_text(label, text, errors, warnings):
    if not isinstance(text, str):
        errors.append(f"{label} 不是字符串")
        return
    if text.count("$") % 2:
        errors.append(f"{label} 的 $ 不成对（公式定界符必须成对）")
    hit = PLACEHOLDER_RE.search(text)
    if hit:
        warnings.append(f"{label} 含占位符样式文本 {hit.group(0)}，可能被构建脚本替换")


def validate(course, packs):
    errors, warnings = [], []
    warnings_list = warnings

    title = str(course.get("title", "")).strip()
    if not title:
        errors.append("course.json 缺少 title")

    seen_pack, seen_q = set(), set()
    total = 0
    per_pack = []

    for fname, pack in packs:
        pid = str(pack.get("id", "")).strip()
        name = str(pack.get("name", "")).strip()
        if not pid:
            errors.append(f"{fname}: 缺少 id")
        if not name:
            errors.append(f"{fname}: 缺少 name")
        if pid in seen_pack:
            errors.append(f"{fname}: 板块 id 重复 {pid}")
        seen_pack.add(pid)

        if not str(pack.get("notes", "")).strip():
            warnings_list.append(f"{fname}: 没有 notes（知识点梳理），页面上会隐藏该折叠块")
        else:
            check_text(f"{fname} 的 notes", pack["notes"], errors, warnings)

        qs = pack.get("questions")
        if not isinstance(qs, list) or not qs:
            errors.append(f"{fname}: questions 为空")
            continue
        per_pack.append((pid, name, len(qs)))

        for i, q in enumerate(qs):
            total += 1
            qid = str(q.get("id", "")).strip()
            where = f"{fname} 第 {i + 1} 题" + (f"（{qid}）" if qid else "")
            if not qid:
                errors.append(f"{where}: 缺少 id")
            elif qid in seen_q:
                errors.append(f"{where}: 题号重复 {qid}")
            seen_q.add(qid)

            qtype = q.get("type")
            if qtype not in TYPES:
                errors.append(f"{where}: type 必须是 {sorted(TYPES)} 之一，当前 {qtype!r}")
                continue

            if not str(q.get("stem", "")).strip():
                errors.append(f"{where}: 缺少 stem")
            else:
                check_text(f"{where} 的 stem", q["stem"], errors, warnings)

            if not str(q.get("solution", "")).strip():
                errors.append(f"{where}: 缺少 solution（解析）")
            else:
                check_text(f"{where} 的 solution", q["solution"], errors, warnings)

            if qtype == "choice":
                opts = q.get("options")
                if not isinstance(opts, list) or len(opts) < 2:
                    errors.append(f"{where}: 选择题 options 至少 2 项")
                else:
                    keys = []
                    for o in opts:
                        if not isinstance(o, list) or len(o) != 2:
                            errors.append(f"{where}: options 每一项必须是 [\"A\", \"选项文本\"]")
                            continue
                        keys.append(str(o[0]))
                        check_text(f"{where} 的选项 {o[0]}", str(o[1]), errors, warnings)
                    if str(q.get("answer", "")) not in keys:
                        errors.append(f"{where}: answer 不在选项 key 里（{keys}）")
                    if len(opts) != 4:
                        warnings_list.append(f"{where}: 选项数为 {len(opts)}，常见为 4")
            elif qtype == "judge":
                if q.get("answer") not in ("对", "错"):
                    errors.append(f"{where}: 判断题 answer 必须是 \"对\" 或 \"错\"")
            elif qtype == "fill":
                fields = q.get("fields")
                if not isinstance(fields, list) or not fields:
                    errors.append(f"{where}: 填空题缺少 fields")
                else:
                    for j, fld in enumerate(fields):
                        label = f"{where} 第 {j + 1} 空"
                        if not str(fld.get("a", "")).strip():
                            errors.append(f"{label}: 缺少答案 a")
                        if fld.get("kind") == "num":
                            if not is_number(fld.get("a")):
                                errors.append(f"{label}: kind=num 但答案 a={fld.get('a')!r} 不是数值/分数")
                            for v in fld.get("alt") or []:
                                if not is_number(v):
                                    warnings_list.append(
                                        f"{label}: alt 里的 {v!r} 不是数值，将按逐字比对（适合 e^{-1} 这类写法）"
                                    )
                        for v in [fld.get("a")] + list(fld.get("alt") or []):
                            if v is not None:
                                check_text(label, str(v), errors, warnings)
            elif qtype == "subjective":
                if not q.get("points"):
                    warnings_list.append(f"{where}: 主观题没有 points，AI 判卷默认按 10 分")
                sol = str(q.get("solution", ""))
                if sol and not re.search(r"评分|给分|分步|步骤|要点|第\s*[0-9一二三四五六七八九十]+\s*步", sol):
                    warnings_list.append(f"{where}: 解析里没有看到评分点，AI 判卷会缺少依据")

    return {
        "errors": errors,
        "warnings": warnings_list,
        "total": total,
        "packs": per_pack,
        "title": title,
    }


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    ap = argparse.ArgumentParser(description="校验题库数据")
    ap.add_argument("--data", default="data", help="数据目录，默认 ./data")
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

    if result["errors"]:
        print(f"\n校验未通过：{len(result['errors'])} 个错误，{len(result['warnings'])} 个提醒")
        return 1

    print(f"[√] 校验通过：{result['total']} 题 / {len(result['packs'])} 个板块")
    for pid, name, n in result["packs"]:
        print(f"    {pid:<4} {name} — {n} 题")
    if result["warnings"]:
        print(f"    （{len(result['warnings'])} 个提醒不影响构建）")
    return 0


if __name__ == "__main__":
    sys.exit(main())

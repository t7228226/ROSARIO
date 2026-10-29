"""Read workforce data locally; never export account/password sheets."""
import argparse
from copy import deepcopy
from collections import Counter
from datetime import date, datetime
from hashlib import sha256
import json
from pathlib import Path
from zipfile import ZipFile

import openpyxl
from lxml import etree


def text(value):
    return str(value or "").strip()


def cell(value):
    return value.isoformat()[:10] if isinstance(value, (date, datetime)) else value


def qualification(value):
    value = text(value)
    if value in ("合格", "訓練中", "不可排", ""):
        return value
    if any(word in value for word in ("導師", "師傅", "可帶")):
        return "合格"
    if "訓練" in value:
        return "訓練中"
    if "不可" in value or "停用" in value:
        return "不可排"
    return value


def records(rows, key):
    header = next((i for i, row in enumerate(rows[:10]) if key in row), None)
    if header is None:
        raise ValueError(f"Missing header: {key}")
    names = rows[header]
    result = []
    for number, row in enumerate(rows[header + 1:], header + 2):
        record = {name: row[i] if i < len(row) else None for i, name in enumerate(names) if name}
        identity = text(record.get(key))
        if not identity or any(marker in identity for marker in ("唯一主鍵", "不可重覆", "不可重複", "規則ID")):
            continue
        result.append((number, record))
    return names, result


def audit(path):
    digest = sha256(path.read_bytes()).hexdigest()
    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    allowed = ("01_人員主表", "02_站點主表", "03_站點矩陣", "03_資格明細", "04_站點規則")
    sheets = {name: [[cell(v) for v in row] for row in workbook[name].values] for name in allowed}
    workbook.close()
    _, people = records(sheets[allowed[0]], "工號")
    _, stations = records(sheets[allowed[1]], "站點代碼")
    matrix_headers, matrix = records(sheets[allowed[2]], "工號")
    _, qualifications = records(sheets[allowed[3]], "工號")
    ids = {text(row["工號"]) for _, row in people}
    station_aliases = {}
    for _, station in stations:
        for alias in (station.get("站點代碼"), station.get("站點名稱")):
            station_aliases[text(alias)] = text(station["站點代碼"])
    columns = {h: station_aliases[h] for h in matrix_headers if h and h in station_aliases}
    unknown = [h for h in matrix_headers if h and h not in columns and h not in ("工號", "姓名", "班別", "職務", "國籍", "備註", "可上線站點數")]
    states = {"合格", "訓練中", "不可排"}
    projected = {}
    invalid = []
    for number, row in matrix:
        for column, station_id in columns.items():
            value = qualification(row.get(column))
            if value in states:
                projected[(text(row["工號"]), station_id)] = value
            elif value:
                invalid.append({"row": number, "column": column, "value": value})
    detail = {}
    duplicates = []
    precedence = {"合格": 1, "訓練中": 2, "不可排": 3}
    for number, row in qualifications:
        key = (text(row["工號"]), text(row.get("站點代碼")))
        status = qualification(row.get("資格狀態"))
        if key in detail:
            duplicates.append({"row": number, "employeeId": key[0], "stationId": key[1]})
        if precedence.get(status, 0) >= precedence.get(detail.get(key), 0):
            detail[key] = status
    mismatches = [{"employeeId": p, "stationId": s, "matrix": projected.get((p, s), ""), "detail": detail.get((p, s), "")}
                  for p, s in sorted(set(projected) | set(detail)) if projected.get((p, s), "") != detail.get((p, s), "")]
    duplicate_people = [key for key, count in Counter(text(r["工號"]) for _, r in people).items() if count > 1]
    matrix_ids = {text(row["工號"]) for _, row in matrix}
    report = {
        "sourceSha256": digest, "peopleCount": len(people), "stationCount": len(stations),
        "matrixPeopleCount": len(matrix), "matrixQualificationCount": len(projected),
        "detailQualificationCount": len(detail), "duplicatePeople": duplicate_people,
        "missingMatrixPeople": sorted(ids - matrix_ids), "unknownMatrixPeople": sorted(matrix_ids - ids),
        "unknownMatrixColumns": unknown, "invalidMatrixStatuses": invalid,
        "duplicateQualificationPairs": duplicates, "qualificationMismatches": mismatches,
        "orphanQualifications": [{"employeeId": p, "stationId": s} for p, s in detail if p not in ids or s not in station_aliases],
        "departures": [{"id": text(r["工號"]), "name": text(r.get("姓名")), "shift": text(r.get("班別")), "status": text(r.get("在職狀態")), "date": cell(r["離職日"])} for _, r in people if r.get("離職日")],
        "limits": ["Read-only; formulas use existing cached results, not recalculated.", "No account/password data exported; no cloud upload or mutation.", "Conflicts are reported, not silently overwritten."],
    }
    return report, sheets


def reconcile_copy(source, target, sheets):
    """Replace only qualification-detail data; preserve every other package member."""
    _, stations = records(sheets["02_站點主表"], "站點代碼")
    aliases = {text(row.get(key)): text(row["站點代碼"]) for _, row in stations for key in ("站點代碼", "站點名稱")}
    headers, matrix = records(sheets["03_站點矩陣"], "工號")
    detail_headers, detail = records(sheets["03_資格明細"], "工號")
    original_rows = {(text(row["工號"]), text(row.get("站點代碼"))): number for number, row in detail}
    ns = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    with ZipFile(source) as archive:
        workbook = etree.fromstring(archive.read("xl/workbook.xml"))
        relation = next(item for item in workbook.findall("s:sheets/s:sheet", ns) if item.get("name") == "03_資格明細")
        rid = relation.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
        relationships = etree.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        part = next(item.get("Target") for item in relationships if item.get("Id") == rid)
        part = part.lstrip("/") if part.startswith("/") else "xl/" + part
        document = etree.fromstring(archive.read(part), etree.XMLParser(resolve_entities=False, no_network=True))
        data = document.find("s:sheetData", ns)
        existing = {int(row.get("r")): row for row in data}
        first = min(original_rows.values(), default=3)
        prototype = existing.get(first)
        for row in list(data):
            if int(row.get("r")) >= first:
                data.remove(row)
        count = 0
        for _, person in matrix:
            for column in headers:
                station_id = aliases.get(column)
                status = qualification(person.get(column))
                if not station_id or not status:
                    continue
                if status not in ("合格", "訓練中", "不可排"):
                    raise ValueError(f"Unrecognized matrix status: {status}")
                employee_id = text(person["工號"])
                old_row = existing.get(original_rows.get((employee_id, station_id)))
                row = deepcopy(old_row if old_row is not None else prototype) if prototype is not None else etree.Element("{" + ns["s"] + "}row")
                number = first + count
                row.set("r", str(number))
                for element in row:
                    if element.tag == "{" + ns["s"] + "}c":
                        letters = "".join(ch for ch in element.get("r", "") if ch.isalpha())
                        element.set("r", letters + str(number))
                        if old_row is None:
                            for child in list(element):
                                element.remove(child)
                changes = {"工號": employee_id, "站點代碼": station_id, "資格狀態": status}
                if old_row is None:
                    changes["資格ID"] = f"MATRIX_{employee_id}_{station_id}"
                if any(word in text(person.get(column)) for word in ("導師", "師傅", "可帶")):
                    changes["可帶人"] = "Y"
                for name, value in changes.items():
                    if name not in detail_headers:
                        continue
                    index = detail_headers.index(name) + 1
                    letters = openpyxl.utils.get_column_letter(index)
                    element = next((c for c in row if c.get("r") == letters + str(number)), None)
                    if element is None:
                        element = etree.SubElement(row, "{" + ns["s"] + "}c", r=letters + str(number))
                    for child in list(element):
                        element.remove(child)
                    element.set("t", "inlineStr")
                    inline = etree.SubElement(element, "{" + ns["s"] + "}is")
                    etree.SubElement(inline, "{" + ns["s"] + "}t").text = value
                row[:] = sorted(row, key=lambda c: openpyxl.utils.column_index_from_string("".join(ch for ch in c.get("r", "A") if ch.isalpha())))
                data.append(row)
                count += 1
        updated = etree.tostring(document, encoding="utf-8", xml_declaration=True)
        with ZipFile(target, "x") as output:
            for member in archive.infolist():
                output.writestr(member, updated if member.filename == part else archive.read(member.filename))
    with ZipFile(source) as original, ZipFile(target) as revised:
        changed = [name for name in original.namelist() if original.read(name) != revised.read(name)]
        if changed != [part]:
            raise ValueError("Unexpected package changes")
    return {"path": str(target), "qualificationCount": count, "changedParts": changed, "sha256": sha256(target.read_bytes()).hexdigest()}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("workbook", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--reconcile-copy", action="store_true")
    args = parser.parse_args()
    target = args.output.resolve()
    private_root = (Path(__file__).resolve().parents[1] / "private-backups").resolve()
    if private_root not in target.parents:
        raise ValueError("Output must remain under ignored private-backups/")
    report, sheets = audit(args.workbook)
    target.mkdir(parents=True, exist_ok=True)
    if args.reconcile_copy:
        report["reconciledCopy"] = reconcile_copy(args.workbook, target / (args.workbook.stem + "_矩陣核對版_014.xlsx"), sheets)
    if sha256(args.workbook.read_bytes()).hexdigest() != report["sourceSha256"]:
        raise ValueError("Source changed during inspection")
    (target / "workbook-audit.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (target / "workbook-snapshot.json").write_text(json.dumps({"sourceSha256": report["sourceSha256"], "sheets": sheets}, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({key: len(value) if isinstance(value, list) else value for key, value in report.items() if key != "limits"}, ensure_ascii=False))

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gasSource = await readFile(path.join(root, "gas-login-fallback-2026-07-01.js"), "utf8");

const peopleHeaders = [
  "工號", "姓名", "班別", "職務", "國籍",
  "(A)第一天", "(A)第二天", "(B)第一天", "(B)第二天",
  "在職狀態", "備註",
];
const matrixHeaders = [...peopleHeaders, "EL01", "更新時間", "更新人"];

function createSheet(rows, { failAppend = false } = {}) {
  const presentationCopies = [];
  const dataValidationCopies = [];
  const sheet = {
    rows: rows.map((row) => [...row]),
    presentationCopies,
    dataValidationCopies,
    getLastRow() { return this.rows.length; },
    getLastColumn() { return Math.max(0, ...this.rows.map((row) => row.length)); },
    appendRow(values) {
      if (failAppend) throw new Error("matrix append failed");
      this.rows.push([...values]);
    },
    deleteRow(rowNumber) { this.rows.splice(rowNumber - 1, 1); },
    getRange(rowNumber, columnNumber, rowCount = 1, columnCount = 1) {
      const range = {
        setValue(value) {
          while (sheet.rows.length < rowNumber) sheet.rows.push([]);
          sheet.rows[rowNumber - 1][columnNumber - 1] = value;
          return range;
        },
        copyTo(_target, options) {
          presentationCopies.push({ rowNumber, columnNumber, rowCount, columnCount, options });
          return range;
        },
        getDataValidations() {
          return Array.from({ length: rowCount }, () => Array(columnCount).fill("validation"));
        },
        setDataValidations(validations) {
          dataValidationCopies.push(validations);
          return range;
        },
      };
      return range;
    },
  };
  return sheet;
}

function createGasContext({ matrixRows, failMatrixAppend = false } = {}) {
  const context = vm.createContext({ console });
  vm.runInContext(gasSource, context);

  const peopleSheet = createSheet([peopleHeaders]);
  const matrixSheet = createSheet(matrixRows || [
    matrixHeaders,
    ["說明", "正式姓名", "班別", "職務", "國籍", "日A", "日A", "夜A", "夜A", "在職", "", "可用值"],
    ["P0001", "既有人員", "翊展班", "技術員", "本國", "日A", "日A", "夜A", "夜A", "在職", "", "合格"],
  ], { failAppend: failMatrixAppend });

  context.getSheet_ = (name) => {
    if (name === "01_人員主表") return peopleSheet;
    if (name === "03_站點矩陣") return matrixSheet;
    throw new Error(`unexpected sheet: ${name}`);
  };
  context.getHeaders_ = (sheet) => sheet === peopleSheet ? peopleHeaders : matrixHeaders;
  context.getSheetObjects_ = (name) => {
    if (name !== "01_人員主表") return [];
    return peopleSheet.rows.slice(1).map((row, rowIndex) => ({
      工號: row[0],
      姓名: row[1],
      __rowNumber: rowIndex + 2,
    }));
  };
  context.readQualificationMatrix_ = () => ({
    sheet: matrixSheet,
    values: matrixSheet.rows.map((row) => [...row]),
    headerRowIndex: 0,
    headers: matrixHeaders,
    employeeIdCol: 0,
    employeeNameCol: 1,
  });

  return { context, peopleSheet, matrixSheet };
}

function newPersonPayload() {
  return {
    id: "P0431",
    name: "吳杏怡",
    shift: "俊志班",
    role: "技術員",
    nationality: "本國",
    aDay1: "夜A",
    aDay2: "夜A",
    bDay1: "休",
    bDay2: "休",
    employmentStatus: "在職",
    note: "新進人員",
  };
}

test("createPerson writes the person master and a blank qualification-matrix row", () => {
  const { context, peopleSheet, matrixSheet } = createGasContext();
  const result = context.createPerson_(newPersonPayload());
  const matrixRow = matrixSheet.rows.at(-1);

  assert.equal(result.ok, true);
  assert.equal(result.matrixRowCreated, true);
  assert.equal(peopleSheet.rows.at(-1)[0], "P0431");
  assert.equal(matrixRow[0], "P0431");
  assert.equal(matrixRow[1], "吳杏怡");
  assert.equal(matrixRow[2], "俊志班");
  assert.equal(matrixRow[10], "新進人員");
  assert.equal(matrixRow[11], "");
  assert.equal(matrixSheet.presentationCopies.length, 1);
  assert.equal(matrixSheet.dataValidationCopies.length, 1);
});

test("createPerson reuses a pre-existing matrix row without clearing qualifications", () => {
  const existingRow = [
    "P0431", "舊姓名", "", "", "", "", "", "", "", "", "", "合格", "", "",
  ];
  const { context, matrixSheet } = createGasContext({ matrixRows: [matrixHeaders, existingRow] });
  const result = context.createPerson_(newPersonPayload());

  assert.equal(result.matrixRowCreated, false);
  assert.equal(matrixSheet.rows.length, 2);
  assert.equal(matrixSheet.rows[1][1], "吳杏怡");
  assert.equal(matrixSheet.rows[1][2], "俊志班");
  assert.equal(matrixSheet.rows[1][11], "合格");
});

test("createPerson rolls back the person master when matrix creation fails", () => {
  const { context, peopleSheet } = createGasContext({ failMatrixAppend: true });

  assert.throws(() => context.createPerson_(newPersonPayload()), /已回滾人員主表/);
  assert.equal(peopleSheet.rows.length, 1);
});

test("validateOnly does not write either sheet", () => {
  const { context, peopleSheet, matrixSheet } = createGasContext();
  const beforeMatrixRows = matrixSheet.rows.length;
  const result = context.createPerson_({ ...newPersonPayload(), validateOnly: true });

  assert.equal(result.validatedOnly, true);
  assert.equal(peopleSheet.rows.length, 1);
  assert.equal(matrixSheet.rows.length, beforeMatrixRows);
});

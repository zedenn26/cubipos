import {Workbook} from 'exceljs';
import {jsPDF} from 'jspdf';
import autoTable from 'jspdf-autotable';
function safeCell(value: unknown) {
  const s = String(value ?? "");
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}
export async function renderReport(rows:Record<string,unknown>[],heading:string,metadata:string,format:'csv'|'xlsx'|'pdf') {
  let body: Uint8Array;
  let type: string;
    if (format === "pdf") {
      const doc = new jsPDF({ orientation: "landscape" });
      doc.setFontSize(16);
      doc.text(heading, 12, 15);
      doc.setFontSize(8);
      doc.text(metadata, 12, 22);
      const columns = rows.length
        ? Object.keys(rows[0]).filter((key) => key !== "id")
        : [];
      autoTable(doc, {
        startY: 30,
        head: [columns.map((key) => key.replaceAll("_", " "))],
        body: rows.map((row) => columns.map((key) => String(row[key] ?? ""))),
        styles: { fontSize: 7, cellPadding: 2 },
        headStyles: { fillColor: [30, 118, 82] },
        margin: { left: 12, right: 12, bottom: 15 },
      });
      const pages = doc.getNumberOfPages();
      for (let p = 1; p <= pages; p++) {
        doc.setPage(p);
        doc.text(`${p} / ${pages}`, 270, 202);
      }
      body = new Uint8Array(doc.output("arraybuffer"));
      type = "application/pdf";
    } else {
      const clean = rows.map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([k, v]) => [
            k,
            typeof v === "number" ? v : safeCell(v),
          ]),
        ),
      );
      const columns = clean.length ? Object.keys(clean[0]) : [];
      const workbook = new Workbook();
      const sheet = workbook.addWorksheet("Report", {
        views: [{ state: "frozen", ySplit: 4 }],
        pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true },
      });
      sheet.addRow([heading]);
      sheet.addRow([metadata]);
      sheet.addRow([]);
      sheet.addRow(columns);
      for (const row of clean) sheet.addRow(columns.map((key) => row[key]));
      sheet.getRow(1).font = {
        size: 16,
        bold: true,
        color: { argb: "FF1E7652" },
      };
      sheet.getRow(4).font = { bold: true, color: { argb: "FFFFFFFF" } };
      sheet.getRow(4).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF1E7652" },
      };
      sheet.columns.forEach((column) => {
        column.width = 22;
      });
      sheet.headerFooter.oddFooter = "Page &P of &N";
      if (format === "csv") {
        const csvRows = [
          [heading],
          [metadata],
          [],
          columns,
          ...clean.map((row) => columns.map((key) => row[key])),
        ];
        body = new TextEncoder().encode(
          "\uFEFF" +
            csvRows
              .map((row) =>
                row
                  .map(
                    (value) =>
                      '"' + String(value ?? "").replaceAll('"', '""') + '"',
                  )
                  .join(","),
              )
              .join("\r\n"),
        );
      } else body = new Uint8Array(await workbook.xlsx.writeBuffer());
      type =
        format === "csv"
          ? "text/csv;charset=utf-8"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    }
  return {body,type};
}

import {describe,it,expect} from 'vitest';
import {Workbook} from 'exceljs';
import {renderReport} from './render';
describe('downloadable reports',()=>{
 it('neutralizes spreadsheet formulas and preserves CSV quoting',async()=>{const {body}=await renderReport([{name:'=HYPERLINK("bad")',note:'A, B',total:100}],'Sales','Test period','csv');const csv=new TextDecoder().decode(body);expect(csv).toContain("'=HYPERLINK");expect(csv).toContain('"A, B"');});
 it('creates a readable XLSX with metadata and typed amounts',async()=>{const {body}=await renderReport([{name:'Milk',total:105}],'Sales','Test period','xlsx');const book=new Workbook();await book.xlsx.load(body as unknown as Parameters<typeof book.xlsx.load>[0]);const sheet=book.getWorksheet('Report')!;expect(sheet.getCell('A1').value).toBe('Sales');expect(sheet.getCell('B5').value).toBe(105);});
 it('creates a PDF document for a report spanning pages',async()=>{const {body}=await renderReport(Array.from({length:100},(_,id)=>({item:`Product ${id}`,amount:id})),'Sales','Test period','pdf');expect(new TextDecoder().decode(body.slice(0,8))).toContain('%PDF-');expect(body.length).toBeGreaterThan(10000);});
});

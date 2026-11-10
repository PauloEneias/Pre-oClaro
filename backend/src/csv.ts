/** Leitor simples de CSV delimitado por ponto-e-vírgula, incluindo aspas e quebras de linha. */
export function parseSemicolonCsv(content:string):string[][] {
  const result:string[][]=[];let row:string[]=[];let field='';let quoted=false;
  for(let i=0;i<content.length;i++){
    const c=content[i];
    if(c==='"'){
      if(quoted && content[i+1]==='"'){field+='"';i++;}
      else if(field==='' || quoted){quoted=!quoted;}
      else throw new Error('Aspas malformadas no CSV.');
    }else if(c===';' && !quoted){row.push(field.trim());field='';}
    else if((c==='\n'||c==='\r') && !quoted){
      if(c==='\r' && content[i+1]==='\n')i++;
      row.push(field.trim());field='';
      if(row.some(v=>v!==''))result.push(row);
      row=[];
    }else field+=c;
  }
  if(quoted)throw new Error('CSV contém campo com aspas não fechadas.');
  row.push(field.trim());if(row.some(v=>v!==''))result.push(row);
  return result;
}
export function gtinValid(gtin:string):boolean {
  if(!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(gtin))return false;
  const digits=gtin.split('').map(Number);
  const check=digits.pop()!;
  const sum=digits.reverse().reduce((total,digit,i)=>total+digit*(i%2===0?3:1),0);
  return (10-sum%10)%10===check;
}
export function parseBrazilPrice(value:string):number {
  const normalized=/^\d{1,7},\d{2}$/.test(value)?value.replace(',','.'):value;
  if(!/^\d{1,7}\.\d{2}$/.test(normalized))throw new Error('Preço deve ter duas casas decimais (ex.: 22,90).');
  const cents=Math.round(Number(normalized)*100);
  if(!Number.isSafeInteger(cents)||cents<=0)throw new Error('Preço deve ser positivo.');
  return cents/100;
}

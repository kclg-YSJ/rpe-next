// The host owns counting and its 500ms time/FPS update. Keep counts compact;
// reserve only the changing clock/FPS digits, without an extra timer or scan.
export function installFooterInfo(source,footer) {
  const output=document.createElement('div');output.id='rpe-classic-footer-stats';output.hidden=true;output.setAttribute('aria-label',source.getAttribute('aria-label')??'');footer.append(output);
  const cells=new Map();
  for(const key of ['Notes','Events','TotalLines','TotalNotes','TotalEvents','Time','FPS']){
    const field=document.createElement('span');field.className='rc-footer-stat';field.dataset.key=key;
    const label=document.createElement('span');label.textContent=key+':';
    const value=document.createElement('span');value.className='rc-footer-value';field.append(label,value);output.append(field);
    if(key==='Time'){
      const parts=[];
      for(const [index,unit]of ['h','m','s'].entries()){
        const number=document.createElement('span');number.className='rc-footer-time-number';
        const suffix=document.createElement('span');suffix.textContent=unit+(index<2?', ':'');
        value.append(number,suffix);parts.push(number);
      }
      cells.set(key,{node:value,parts});
    }else cells.set(key,{node:value});
  }
  const sync=()=>{
    if(output.hidden!==source.hidden)output.hidden=source.hidden;
    if(source.hidden)return;
    const text=source.querySelector('dd')?.textContent??'';
    const values=new Map([...text.matchAll(/(Notes|Events|TotalLines|TotalNotes|TotalEvents|Time|FPS):\s*(.*?)(?=\s+(?:Notes|Events|TotalLines|TotalNotes|TotalEvents|Time|FPS):|$)/g)].map(match=>[match[1],match[2].trim()]));
    for(const [key,{node,parts}]of cells){
      const value=values.get(key)??'—';
      if(parts){
        const time=/([\d.]+)\s*h\s*,?\s*([\d.]+)\s*m\s*,?\s*([\d.]+)\s*s/i.exec(value);
        for(const [i,part]of parts.entries()){
          const text=time?String(Number(time[i+1])):'—';
          if(part.textContent!==text)part.textContent=text;
        }
      }else if(node.textContent!==value)node.textContent=value;
      if(node.title!==value)node.title=value;
    }
  };
  const observer=new MutationObserver(sync);observer.observe(source,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['hidden']});sync();
  return ()=>{observer.disconnect();output.remove();};
}

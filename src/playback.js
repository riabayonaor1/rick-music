import {beatsPerMeasure,noteLayer} from './model.js';
// Repeat traversal is bounded so malformed imported documents cannot loop forever.
export function playbackOrder(score){
 const measures=score.parts[0].measures,visits=new Map(),order=[],starts=[];
 for(let i=0;i<measures.length&&order.length<4096;i++){
  const m=measures[i];if(m.repeatStart&&starts.at(-1)!==i)starts.push(i);order.push(i);
  if(m.repeatEnd){const count=visits.get(i)||0,times=Math.min(16,Math.max(2,m.times||2));if(count<times-1){visits.set(i,count+1);i=(starts.at(-1)??0)-1;}else{visits.delete(i);starts.pop();}}
 }
 if(order.length>=4096)throw Error('La secuencia de repeticiones es demasiado larga.');return order;
}
export function buildPlayback(score){
 const order=playbackOrder(score),beats=beatsPerMeasure(score),segments=[];let seconds=0,tempo=score.tempo;
 for(const mi of order){tempo=score.parts[0].measures[mi].tempo||tempo;const beat=60/tempo;segments.push({mi,start:seconds,beat});seconds+=beats*beat;}
 const parts=score.parts.map(p=>{const events=[];for(const segment of segments)for(let layer=1;layer<=4;layer++){let at=0;for(const [ni,n]of p.measures[segment.mi].notes.entries()){if(noteLayer(n)!==layer)continue;events.push({n,ni,mi:segment.mi,layer,start:segment.start+at*segment.beat,duration:n.duration*segment.beat,beat:segment.beat});at+=n.duration;}}
  events.sort((a,b)=>a.layer-b.layer||a.start-b.start);const notes=[],visual=[];let velocity=.65;
  for(let i=0;i<events.length;i++){const e=events[i],n=e.n;if(n.dynamic)velocity={ppp:.12,pp:.2,p:.35,mp:.5,mf:.65,f:.8,ff:.95,fff:1,sfz:1,fp:.7}[n.dynamic]??velocity;visual.push({mi:e.mi,ni:e.ni,start:e.start,duration:e.duration});if(n.rest)continue;
   const prev=events[i-1],same=(a,b)=>a&&b&&a.layer===b.layer&&Math.abs(a.start+a.duration-b.start)<1e-5&&JSON.stringify(a.n.pitches)===JSON.stringify(b.n.pitches);
   if(prev?.n.tie&&same(prev,e))continue;let length=e.duration,j=i;while(events[j]?.n.tie&&same(events[j],events[j+1]))length+=events[++j].duration;
   const start=Math.max(0,e.start+(n.timing||0)*e.beat),v=n.velocity??Math.round(velocity*127);for(const writtenPitch of n.pitches)notes.push({pitch:Math.max(0,Math.min(127,writtenPitch-(p.transpose||0))),at:start,duration:length*(n.articulation==='staccato'?.4:n.articulation==='staccatissimo'?.25:.96),velocity:v});
  }return{program:p.program,volume:p.volume,muted:p.muted,percussion:!!p.percussion,notes,visual};});
 let duration=seconds;for(const part of parts)if(!part.muted)for(const note of part.notes)duration=Math.max(duration,note.at+note.duration);
 return{parts,duration,segments,beats};
}

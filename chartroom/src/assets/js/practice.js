/* Sectional Practice: two linked maps (FAA VFR sectional on 3D terrain, live airspace as 3D volumes) plus a quiz.
   Needs maplibregl and deck from assets/vendor. Usage events go through window.CR.track and carry no location. */
// ---------- config ----------
const SECT='https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/VFR_Sectional/MapServer/tile/{z}/{y}/{x}';
const AIR='https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Class_Airspace/FeatureServer/0/query';
const DEM='https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const QS=new URLSearchParams(location.search);
const START=(QS.has('lat')&&QS.has('lon')&&isFinite(+QS.get('lat'))&&isFinite(+QS.get('lon')))
  ?{center:[+QS.get('lon'),+QS.get('lat')],zoom:Math.min(14,Math.max(6,+QS.get('z')||10.5))}
  :{center:[-122.31,47.45],zoom:9.5};
const COL={B:'#3b82f6',C:'#d946ef',D:'#3b82f6',E:'#d946ef'};
const $=id=>document.getElementById(id);

// ---------- helpers ----------
function fmt(v,uom,code){
  if(code==='SFC'||v===0) return 'SFC';
  if(v==null||v<=-9000) return 'n/a';
  if(String(uom||'').toUpperCase()==='FL') return 'FL'+v;
  return v.toLocaleString()+' ft '+(String(code).toUpperCase()==='AGL'?'AGL':'MSL');
}
function enrich(f){
  const p=f.properties;
  p.floor=fmt(p.LOWER_VAL,p.LOWER_UOM,p.LOWER_CODE);
  p.ceil=fmt(p.UPPER_VAL,p.UPPER_UOM,p.UPPER_CODE);
  p.label=`${p.NAME||p.CLASS}\n${p.floor} to ${p.ceil}`;
  return f;
}

// ---------- maps ----------
const mapL=new maplibregl.Map({container:'mapL',...START,pitch:55,bearing:0,minZoom:6,maxZoom:15,maxPitch:80,
  style:{version:8,sources:{
    faa:{type:'raster',tiles:[SECT],tileSize:256,minzoom:8,maxzoom:12,attribution:'FAA Aeronautical Information Services'},
    dem:{type:'raster-dem',tiles:[DEM],encoding:'terrarium',tileSize:256,maxzoom:14,attribution:'Terrain: AWS Terrain Tiles'}},
   layers:[{id:'bg',type:'background',paint:{'background-color':'#0a0e14'}},{id:'faa',type:'raster',source:'faa'}],
   terrain:{source:'dem',exaggeration:1.5}}});
mapL.addControl(new maplibregl.NavigationControl({visualizePitch:true}),'top-right');
mapL.getCanvas().setAttribute('aria-label','Sectional chart map, 3D');

const mapR=new maplibregl.Map({container:'mapR',...START,pitch:55,bearing:0,maxPitch:80,minZoom:6,maxZoom:15,attributionControl:{compact:true},
  style:BASEMAP.style({air:{type:'geojson',data:{type:'FeatureCollection',features:[]}}})});
mapR.addControl(new maplibregl.NavigationControl({visualizePitch:true}),'top-right');
mapR.getCanvas().setAttribute('aria-label','Airspace map, 3D');

// ---------- 3D airspace volumes (deck.gl) ----------
const FT=0.3048;
let airData=null,overlay=null;
if(window.deck&&deck.MapboxOverlay){overlay=new deck.MapboxOverlay({interleaved:false,layers:[]});mapR.addControl(overlay)}
else $('status').textContent='3D airspace library did not load (flat view only)';
const RGB={B:[59,130,246],C:[217,70,239],D:[96,165,250],E:[217,70,239]};
const ALPHA={B:46,C:46,D:38,E:20};
const toFt=(v,uom,code)=>{if(String(code).toUpperCase()==='SFC'||v===0)return 0;if(v==null||v<=-9000)return null;return String(uom||'').toUpperCase()==='FL'?v*100:v};
function volumes(){
  const on=[...document.querySelectorAll('.cls')].filter(c=>c.checked).map(c=>c.value);
  const out=[];
  (airData?.features||[]).forEach(f=>{
    const p=f.properties;if(!on.includes(p.CLASS))return;
    const floor=toFt(p.LOWER_VAL,p.LOWER_UOM,p.LOWER_CODE)??0;
    let ceil=toFt(p.UPPER_VAL,p.UPPER_UOM,p.UPPER_CODE);
    if(ceil==null)ceil=18000;               // no charted ceiling: runs up to Class A (18,000 ft MSL)
    if(ceil<=floor)ceil=floor+300;
    const g=f.geometry;if(!g)return;
    const polys=g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];
    polys.forEach(rings=>out.push({rings,p,floor,ceil}));
  });
  return out;
}
function updateDeck(){
  if(!overlay)return;
  if(!$('a3d').checked||quizActive){overlay.setProps({layers:[]});return}
  const ex=+$('aex').value;
  overlay.setProps({layers:[new deck.PolygonLayer({
    id:'vol',data:volumes(),pickable:true,extruded:true,wireframe:true,filled:true,material:false,
    parameters:{depthWriteEnabled:false},
    getPolygon:d=>d.rings.map(r=>r.map(c=>[c[0],c[1],d.floor*FT*ex])),
    getElevation:d=>(d.ceil-d.floor)*FT*ex,
    getFillColor:d=>[...(RGB[d.p.CLASS]||[148,163,184]),ALPHA[d.p.CLASS]||30],
    getLineColor:d=>[...(RGB[d.p.CLASS]||[148,163,184]),210],
    lineWidthMinPixels:1,
    updateTriggers:{getPolygon:[ex],getElevation:[ex]}
  })]});
}
// in 3D the flat shading under the volumes is hidden but still clickable; the ground outline stays as a shadow
function applyMode(){
  if(!mapR.getLayer('air-fill'))return;
  mapR.setPaintProperty('air-fill','fill-opacity',$('a3d').checked?0:['match',['get','CLASS'],'E',.06,.13]);
  updateDeck();
}

const colorExpr=['match',['get','CLASS'],'B',COL.B,'C',COL.C,'D',COL.D,'E',COL.E,'#94a3b8'];
mapR.once('style.load',()=>{
  setTimeout(()=>applyMode(),0);
  mapR.addLayer({id:'air-fill',type:'fill',source:'air',paint:{'fill-color':colorExpr,'fill-opacity':['match',['get','CLASS'],'E',.06,.13]}});
  mapR.addLayer({id:'air-solid',type:'line',source:'air',filter:['in',['get','CLASS'],['literal',['B','C']]],paint:{'line-color':colorExpr,'line-width':2}});
  mapR.addLayer({id:'air-dash',type:'line',source:'air',filter:['in',['get','CLASS'],['literal',['D','E']]],paint:{'line-color':colorExpr,'line-width':1.6,'line-dasharray':[3,2]}});
  mapR.addLayer({id:'air-lbl',type:'symbol',source:'air',layout:{'text-field':['get','label'],'text-font':['Open Sans Regular'],'text-size':11,'text-allow-overlap':false},paint:{'text-color':'#fff','text-halo-color':'#0a0e14','text-halo-width':1.5}});
  loadAir();
});
mapR.on('moveend',()=>{clearTimeout(window._t);window._t=setTimeout(loadAir,350)});

// ---------- airspace fetch ----------
let ctl;
async function loadAir(){
  if(!mapR.getSource('air')) return;
  if(mapR.getZoom()<7){$('status').textContent='Zoom in to load airspace';return}
  const b=mapR.getBounds();ctl?.abort();ctl=new AbortController();
  const q=new URLSearchParams({where:"CLASS IN ('B','C','D','E')",geometry:[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()].join(','),geometryType:'esriGeometryEnvelope',inSR:4326,spatialRel:'esriSpatialRelIntersects',outFields:'*',outSR:4326,f:'geojson'});
  $('status').textContent='Loading airspace…';
  try{
    const r=await fetch(AIR+'?'+q,{signal:ctl.signal});const j=await r.json();
    if(!j.features) throw new Error('bad response');
    j.features.forEach(enrich);
    mapR.getSource('air').setData(j);airData=j;updateDeck();
    $('status').textContent=j.features.length+' airspace areas'+(j.exceededTransferLimit?' (zoom in for more)':'');
  }catch(e){if(e.name!=='AbortError')$('status').textContent='Airspace feed unavailable'}
}

// ---------- link ----------
let lock=false;
function link(a,b){a.on('move',()=>{if(lock||!$('link').checked)return;lock=true;const o={center:a.getCenter(),zoom:a.getZoom()};if($('linkang').checked){o.bearing=a.getBearing();o.pitch=a.getPitch()}b.jumpTo(o);lock=false})}
link(mapL,mapR);link(mapR,mapL);
$('link').onchange=()=>{if($('link').checked){lock=true;mapR.jumpTo({center:mapL.getCenter(),zoom:mapL.getZoom()});lock=false}};
$('exag').oninput=e=>mapL.setTerrain({source:'dem',exaggeration:+e.target.value});
$('tilt').oninput=e=>mapL.setPitch(+e.target.value);
mapL.on('pitch',()=>{$('tilt').value=Math.round(mapL.getPitch())});
$('a3d').onchange=applyMode;$('aex').oninput=updateDeck;document.querySelectorAll('.cls').forEach(c=>c.onchange=updateDeck);
$('lbl').onchange=e=>{if(!quizActive)mapR.setLayoutProperty('air-lbl','visibility',e.target.checked?'visible':'none')};

// ---------- click details ----------
mapR.on('click',e=>{
  if(quizActive) return;
  if(overlay&&$('a3d').checked){
    const hit=overlay.pickObject({x:e.point.x,y:e.point.y,radius:4});
    if(hit&&hit.object){const p=hit.object.p;
      new maplibregl.Popup().setLngLat(e.lngLat).setHTML(`<b style="color:${COL[p.CLASS]||'#94a3b8'}">Class ${p.CLASS}</b> ${p.NAME||''}<br>Floor: ${p.floor}<br>Ceiling: ${p.ceil}<br><span style="color:#8a9bb3">Heights drawn ×${$('aex').value}</span>`).addTo(mapR);
      return}
  }
  const fs=mapR.queryRenderedFeatures(e.point,{layers:['air-fill']});
  if(!fs.length) return;
  const seen=new Set(),rows=[];
  fs.forEach(f=>{const p=f.properties,k=p.NAME+p.floor+p.ceil;if(seen.has(k))return;seen.add(k);
    rows.push(`<b style="color:${COL[p.CLASS]||'#94a3b8'}">Class ${p.CLASS}</b> ${p.NAME||''}<br>Floor: ${p.floor}<br>Ceiling: ${p.ceil}`)});
  new maplibregl.Popup().setLngLat(e.lngLat).setHTML(rows.join('<hr style="border:0;border-top:1px solid #1e2a3b;margin:8px 0">')).addTo(mapR);
});

// ---------- local airports (the shared LOCAL module lives in local.js) ----------
function showLocalOnMap(){
  if(!mapR.getSource('local')){
    mapR.addSource('local',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    mapR.addLayer({id:'local-dot',type:'circle',source:'local',paint:{'circle-radius':['match',['get','rank'],0,6,1,5,3.5],'circle-color':'#ffb020','circle-stroke-color':'#0a0e14','circle-stroke-width':2}});
    mapR.addLayer({id:'local-lbl',type:'symbol',source:'local',layout:{'text-field':['get','ident'],'text-font':['Open Sans Regular'],'text-size':12,'text-offset':[0,1.1],'text-anchor':'top','text-optional':true,'symbol-sort-key':['get','rank']},paint:{'text-color':'#ffb020','text-halo-color':'#0a0e14','text-halo-width':1.6}});
  }
  mapR.getSource('local').setData({type:'FeatureCollection',features:LOCAL.on?LOCAL.airports.map(a=>({type:'Feature',properties:{ident:a.id,rank:a.type==='L'?0:a.type==='M'?1:2},geometry:{type:'Point',coordinates:[a.lon,a.lat]}})):[]});
}
function nearTxt(){
  if(!near)return '';
  const a=near.a,away=Math.round(LOCAL.mi(a.nm));
  return `<br><span class="mono" style="color:var(--amber);font-size:13px"><i class="ph ph-map-pin" aria-hidden="true"></i> The pin is ${near.nm.toFixed(1)} NM ${near.dir} of ${a.name}${a.id?' ('+a.id+')':''}${a.city?', '+a.city:''}, field elevation ${a.elev.toLocaleString('en-US')} ft. That field is about ${away}&nbsp;mi from you. Find it on the chart.</span>`;
}
let styleReady=false;
mapR.once('style.load',()=>{styleReady=true;if(LOCAL.on)showLocalOnMap();});
const drawLocal=()=>{if(styleReady)showLocalOnMap();};
LOCAL.mountControl($('loc-mount'));
LOCAL.subscribe((L,reason)=>{
  drawLocal();
  if(reason==='enabled'){window.CR?.track('location_enabled');if(L.airports[0])mapL.jumpTo({center:[L.airports[0].lon,L.airports[0].lat],zoom:10.5});}
});

// ---------- practice mode ----------
const SPOTS=[[47.449,-122.309],[47.907,-122.282],[47.268,-122.578],[45.589,-122.595],[39.856,-104.674],[40.788,-111.978],[30.194,-97.67],[42.364,-71.005],[33.943,-118.408],[41.978,-87.904],[33.64,-84.427],[25.793,-80.29],[36.08,-115.152],[44.88,-93.217],[39.049,-77.46]];
const KEY={B:'Class B (solid blue): surface to ~10,000 ft MSL around the nation’s busiest airports; needs an ATC clearance.',C:'Class C (solid magenta): two-way radio contact required before entering.',D:'Class D (dashed blue): towered airports; two-way radio contact required before entering.',E:'Class E (dashed magenta / shaded vignette): controlled airspace; no clearance needed under VFR, but weather minimums apply.',G:'Class G: uncontrolled airspace; no charted boundary here.'};
const PRI={B:4,C:3,D:2,E:1};
let quizActive=false,pin=null,mk=[],score=[0,0],cur=null,near=null;
const shuffle=a=>a.map(v=>[Math.random(),v]).sort((x,y)=>x[0]-y[0]).map(x=>x[1]);

async function pointAir(lon,lat){
  const q=new URLSearchParams({where:"CLASS IN ('B','C','D','E')",geometry:lon+','+lat,geometryType:'esriGeometryPoint',inSR:4326,spatialRel:'esriSpatialRelIntersects',outFields:'*',returnGeometry:'true',outSR:4326,maxAllowableOffset:0.002,geometryPrecision:4,f:'geojson'});
  const j=await (await fetch(AIR+'?'+q)).json();
  if(!j.features) throw new Error();
  return j.features.map(enrich);
}
// ---------- show the answer on the sectional ----------
let revealMk=[];
function clearReveal(){
  ['reveal-line','reveal-glow','reveal-fill'].forEach(l=>mapL.getLayer(l)&&mapL.removeLayer(l));
  if(mapL.getSource('reveal'))mapL.removeSource('reveal');
  revealMk.forEach(m=>m.remove());revealMk=[];
}
const hundreds=ft=>ft==null?'n/a':Math.round(ft/100);
// the chart prints limits in hundreds of feet MSL: ceiling on top, floor underneath ("SFC" = surface)
function chartLimits(p){
  const hi=toFt(p.UPPER_VAL,p.UPPER_UOM,p.UPPER_CODE),lo=toFt(p.LOWER_VAL,p.LOWER_UOM,p.LOWER_CODE);
  return `${hundreds(hi)}<br>${lo===0?'SFC':hundreds(lo)}`;
}
function revealOnChart(feat,cls,showLimits){
  clearReveal();
  const g=feat&&feat.geometry;
  const polys=g?(g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[]):[];
  const bb=new maplibregl.LngLatBounds(pin,pin);
  let data,anchor,label;
  if(polys.length){
    polys.forEach(r=>r[0].forEach(c=>bb.extend(c)));
    data={type:'Feature',geometry:g,properties:{}};
    let bd=1e9;anchor=pin;                      // charted limits sit on the boundary: use the edge nearest the pin
    polys.forEach(r=>r[0].forEach(c=>{const d=Math.hypot((c[0]-pin[0])*Math.cos(pin[1]*Math.PI/180),c[1]-pin[1]);if(d<bd){bd=d;anchor=c}}));
    label=(showLimits?'<b>'+chartLimits(feat.properties)+'</b>':'')+`<small>Class ${cls}</small>`;
  }else{                                         // Class G: there is no boundary to find
    const ring=[...Array(49)].map((_,i)=>[pin[0]+.05*Math.cos(2*Math.PI*i/48),pin[1]+.04*Math.sin(2*Math.PI*i/48)]);
    data={type:'Feature',geometry:{type:'Polygon',coordinates:[ring]},properties:{}};
    ring.forEach(c=>bb.extend(c));anchor=ring[12];
    label='<small>Class G</small><small>no airspace lines here</small>';
  }
  mapL.addSource('reveal',{type:'geojson',data});
  mapL.addLayer({id:'reveal-fill',type:'fill',source:'reveal',paint:{'fill-color':'#ffb020','fill-opacity':.14}});
  mapL.addLayer({id:'reveal-glow',type:'line',source:'reveal',paint:{'line-color':'#ffb020','line-width':10,'line-opacity':.3,'line-blur':4}});
  mapL.addLayer({id:'reveal-line',type:'line',source:'reveal',paint:{'line-color':'#ffd166','line-width':3}});
  const el=document.createElement('div');el.className='revchip mono';el.innerHTML=label;
  revealMk.push(new maplibregl.Marker({element:el}).setLngLat(anchor).addTo(mapL));
  mapL.fitBounds(bb,{padding:{top:70,bottom:70,left:70,right:70},maxZoom:11.5,duration:1400});
}
function setQuizVis(on){
  quizActive=on;const v=on?'none':'visible';
  ['air-fill','air-solid','air-dash','air-lbl'].forEach(l=>mapR.getLayer(l)&&mapR.setLayoutProperty(l,'visibility',(l==='air-lbl'&&!$('lbl').checked&&!on)?'none':v));
  updateDeck();
}
function showQ(text,opts,onPick){
  $('q').innerHTML=text;$('fb').innerHTML='';const o=$('opts');o.innerHTML='';
  opts.forEach(t=>{const b=document.createElement('button');b.className='opt';b.textContent=t;b.onclick=()=>onPick(t,b);o.appendChild(b)});
}
function mark(ok,btn,correct){
  [...$('opts').children].forEach(b=>{b.disabled=true;if(b.textContent===correct)b.classList.add('ok')});
  if(!ok)btn.classList.add('bad');
  score[1]++;if(ok)score[0]++;$('score').textContent=score.join(' / ');
}
function next(){const n=document.createElement('button');n.className='btn sm';n.textContent='Next pin →';n.onclick=startQuiz;n.style.marginTop='10px';$('fb').appendChild(n)}

async function startQuiz(){
  clearReveal();
  window.CR?.track('quiz_started',{local:!!(LOCAL.on&&LOCAL.airports.length)});
  mk.forEach(m=>m.remove());mk=[];
  near=null;
  if(LOCAL.on&&LOCAL.airports.length){
    const a=LOCAL.pick();
    const r=(Math.random()*3.2+0.4)/60, th=Math.random()*2*Math.PI;     // 0.4 to 3.6 NM from the field
    pin=[a.lon+r*Math.sin(th)/Math.cos(a.lat*Math.PI/180),a.lat+r*Math.cos(th)];
    near={a,nm:LOCAL.nm(a.lat,a.lon,pin[1],pin[0]),dir:LOCAL.compass(LOCAL.bearing(a.lat,a.lon,pin[1],pin[0]))};
  }else{
    const [la,lo]=SPOTS[Math.floor(Math.random()*SPOTS.length)];
    pin=[lo+(Math.random()-.5)*.3,la+(Math.random()-.5)*.25];
  }
  $('link').checked=true;setQuizVis(true);mapR.getPopup?.();
  mapL.jumpTo({center:pin,zoom:10.5,pitch:50,bearing:0});
  mk=[mapL,mapR].map(m=>new maplibregl.Marker({color:'#ffb020'}).setLngLat(pin).addTo(m));
  mk.forEach(x=>x.getElement().setAttribute('role','img'));
  $('q').innerHTML='Locating pin…';$('opts').innerHTML='';$('fb').textContent='';
  let fs;try{fs=await pointAir(pin[0],pin[1])}catch(e){$('q').innerHTML='Airspace feed unavailable right now. Try again.';setQuizVis(false);return}
  const top=fs.sort((a,b)=>(PRI[b.properties.CLASS]||0)-(PRI[a.properties.CLASS]||0))[0];
  const cls=top?top.properties.CLASS:'G';
  showQ('<b>Q1.</b> Use the sectional (left). What is the <u>highest-priority airspace class</u> at the amber pin?'+nearTxt(),['Class B','Class C','Class D','Class E','Class G'],(t,b)=>{
    const ok=t==='Class '+cls;mark(ok,b,'Class '+cls);setQuizVis(false);window.CR?.track('quiz_answered',{question:1,correct:ok});
    const p=top?.properties;
    if(!ok)revealOnChart(top,cls,false);
    $('fb').innerHTML=`${ok?'<i class="ph ph-check-circle ok" aria-hidden="true"></i> Correct.':'<i class="ph ph-x-circle bad" aria-hidden="true"></i> Not quite.'} It’s <b>Class ${cls}</b>${p?`${p.NAME?' ('+p.NAME+')':''}, floor ${p.floor}, ceiling ${p.ceil}`:''}.<br>${KEY[cls]}<br>${ok?'':'<i class="ph ph-map-pin" aria-hidden="true"></i> Look at the sectional (left): the correct airspace is outlined in amber.<br>'}`;
    if(top&&p.ceil!=='n/a'){const n=document.createElement('button');n.className='btn sm';n.textContent='Q2: ceiling →';n.style.marginTop='10px';n.onclick=()=>q2(top);$('fb').appendChild(n)}else next();
  });
}
function q2(feat){
  const p=feat.properties;
  clearReveal();
  mapL.fitBounds(new maplibregl.LngLatBounds(pin,pin).extend([pin[0]+.2,pin[1]+.15]).extend([pin[0]-.2,pin[1]-.15]),{maxZoom:10.5,duration:900});
  setQuizVis(true);
  const pool=['2,500 ft MSL','3,000 ft MSL','4,000 ft MSL','4,100 ft MSL','6,000 ft MSL','7,000 ft MSL','10,000 ft MSL','14,500 ft MSL','18,000 ft MSL'].filter(x=>x!==p.ceil);
  const opts=shuffle([p.ceil,...shuffle(pool).slice(0,3)]);
  showQ(`<b>Q2.</b> What is the <u>ceiling</u> of that Class ${p.CLASS} airspace (${p.NAME||'at the pin'})?`,opts,(t,b)=>{
    const ok=t===p.ceil;mark(ok,b,p.ceil);setQuizVis(false);window.CR?.track('quiz_answered',{question:2,correct:ok});
    if(!ok)revealOnChart(feat,p.CLASS,true);
    $('fb').innerHTML=`${ok?'<i class="ph ph-check-circle ok" aria-hidden="true"></i> Correct.':'<i class="ph ph-x-circle bad" aria-hidden="true"></i> Not quite.'} Ceiling <b>${p.ceil}</b>, floor <b>${p.floor}</b>. On the sectional, look for the numbers in the boundary: the top is the upper value, the bottom is the lower (“SFC” means surface).<br>${ok?'':'<i class="ph ph-map-pin" aria-hidden="true"></i> The amber tag on the sectional (left) shows how the chart prints it, in hundreds of feet: ceiling over floor.<br>'}`;
    next();
  });
}
$('newq').onclick=startQuiz;


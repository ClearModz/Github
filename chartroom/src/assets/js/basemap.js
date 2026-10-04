/* Chartroom dark base map: OpenFreeMap vector tiles (no API key) drawn in the site's colors.
   BASEMAP.style(extraSources, extraLayers) returns a MapLibre style. Keep it identical on every page. */
window.BASEMAP={
  glyphs:'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  source:{type:'vector',url:'https://tiles.openfreemap.org/planet',attribution:'<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> © OpenMapTiles · Data © OpenStreetMap contributors · Airspace: FAA AIS'},
  layers:[

    {id:'bg',type:'background',paint:{'background-color':'#0d1420'}},
    {id:'b-park',type:'fill',source:'base','source-layer':'park',paint:{'fill-color':'#0f1c1a'}},
    {id:'b-water',type:'fill',source:'base','source-layer':'water',paint:{'fill-color':'#08111c'}},
    {id:'b-bound',type:'line',source:'base','source-layer':'boundary',filter:['<=',['get','admin_level'],4],paint:{'line-color':'#2c3b52','line-width':1,'line-dasharray':[3,2]}},
    {id:'b-road-minor',type:'line',source:'base','source-layer':'transportation',minzoom:11,filter:['in',['get','class'],['literal',['minor','service','tertiary']]],paint:{'line-color':'#182233','line-width':['interpolate',['linear'],['zoom'],11,.4,15,2]}},
    {id:'b-road',type:'line',source:'base','source-layer':'transportation',minzoom:7,filter:['in',['get','class'],['literal',['motorway','trunk','primary','secondary']]],paint:{'line-color':'#2a3a52','line-width':['interpolate',['linear'],['zoom'],7,.5,15,3.5]}},
    {id:'b-apron',type:'fill',source:'base','source-layer':'aeroway',minzoom:10,filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':'#1a2433'}},
    {id:'b-runway',type:'line',source:'base','source-layer':'aeroway',minzoom:9,filter:['in',['get','class'],['literal',['runway','taxiway']]],paint:{'line-color':'#8a9bb3','line-width':['interpolate',['linear'],['zoom'],9,.6,15,7]}}
  ],
  style(extraSources={},extraLayers=[]){
    return {version:8,glyphs:this.glyphs,sources:{base:this.source,...extraSources},layers:[...this.layers,...extraLayers]};
  }
};

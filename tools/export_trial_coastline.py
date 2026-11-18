"""Export the same exact-ID closed mainland coastline for DEM masking."""
import argparse,json
import osmium
from build_osm_mainland_pilot import coastline_rings
def export(pbf,output):
    lines=[];needed=set();coords={}
    class Ways(osmium.SimpleHandler):
        def way(self,way):
            if way.tags.get('natural')=='coastline':
                refs=[node.ref for node in way.nodes];lines.append(refs);needed.update(refs)
    class Nodes(osmium.SimpleHandler):
        def node(self,node):
            if node.id in needed and node.location.valid():coords[node.id]=[node.location.lon,node.location.lat]
    Ways().apply_file(pbf);Nodes().apply_file(pbf);ring,stats=coastline_rings(lines,coords)
    with open(output,'w',encoding='utf-8') as file:json.dump({'type':'Polygon','coordinates':[ring],'sourceStats':stats},file)
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('pbf');parser.add_argument('output');args=parser.parse_args();export(args.pbf,args.output)

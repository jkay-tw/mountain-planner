import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.mapsforge.map.reader.MapFile;
import org.mapsforge.map.datastore.*;
import org.mapsforge.core.model.*;
public class ExtractHappymanTracks {
 static int tx(double x,int z){return (int)Math.floor((x+180)/360*(1<<z));}
 static int ty(double x,int z){double r=Math.toRadians(x);return (int)Math.floor((1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*(1<<z));}
 static String q(String s){StringBuilder b=new StringBuilder("\"");for(char c:s.toCharArray()){if(c=='"'||c=='\\')b.append('\\').append(c);else if(c<32)b.append(String.format("\\u%04x",(int)c));else b.append(c);}return b.append('"').toString();}
 public static void main(String[] args)throws Exception{
  MapFile f=new MapFile(new File(args[0]));long count=0;int z=18,top=ty(24.7,z),bottom=ty(22.3,z);
  try(PrintWriter out=new PrintWriter(new OutputStreamWriter(new FileOutputStream(args[1]),StandardCharsets.UTF_8))){
   for(int y=top;y<=bottom;y+=64){
    MapReadResult r=f.readMapData(new Tile(tx(120.5,z),y,(byte)z,256),new Tile(tx(121.9,z),Math.min(bottom,y+63),(byte)z,256));
    if(r==null)throw new IOException("Map read failed");
    for(Way w:r.ways){
     TreeMap<String,String> tags=new TreeMap<>();for(Tag t:w.tags)tags.put(t.key,t.value);
     for(LatLong[] line:w.latLongs){if(line.length<2)continue;StringBuilder b=new StringBuilder("{\"coordinates\":[");
      boolean first=true;for(LatLong p:line){if(!first)b.append(',');first=false;b.append('[').append(p.longitude).append(',').append(p.latitude).append(']');}
      b.append("],\"tags\":{");first=true;for(Map.Entry<String,String> t:tags.entrySet()){if(!first)b.append(',');first=false;b.append(q(t.getKey())).append(':').append(q(t.getValue()));}out.println(b.append("}}"));count++;
     }
    }
   }
  }f.close();System.err.println("recorded polylines="+count);
 }
}

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.mapsforge.map.reader.MapFile;
import org.mapsforge.map.datastore.MapReadResult;
import org.mapsforge.map.datastore.PointOfInterest;
import org.mapsforge.core.model.Tile;
import org.mapsforge.core.model.Tag;
public class ExtractHappyman {
 static int tx(double lon,int z){return (int)Math.floor((lon+180)/360*(1<<z));}
 static int ty(double lat,int z){double r=Math.toRadians(lat);return (int)Math.floor((1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*(1<<z));}
 static String q(String s){StringBuilder b=new StringBuilder("\"");for(char c:s.toCharArray()){if(c=='"'||c=='\\')b.append('\\').append(c);else if(c<32)b.append(String.format("\\u%04x",(int)c));else b.append(c);}return b.append('"').toString();}
 public static void main(String[] args)throws Exception{
  MapFile file=new MapFile(new File(args[0]));
  System.err.println("bbox="+file.getMapFileInfo().boundingBox+" version="+file.getMapFileInfo().fileVersion);
  double minLat=Double.parseDouble(args[2]),minLon=Double.parseDouble(args[3]),maxLat=Double.parseDouble(args[4]),maxLon=Double.parseDouble(args[5]);int zoom=18;long count=0;
  try(PrintWriter out=new PrintWriter(new OutputStreamWriter(new FileOutputStream(args[1]),StandardCharsets.UTF_8))){
   int top=ty(maxLat,zoom),bottom=ty(minLat,zoom);
   for(int y=top;y<=bottom;y+=64){
    MapReadResult result=file.readPoiData(new Tile(tx(minLon,zoom),y,(byte)zoom,256),new Tile(tx(maxLon,zoom),Math.min(bottom,y+63),(byte)zoom,256));
    if(result==null)throw new IOException("Reader returned null at tile row "+y);
    for(PointOfInterest p:result.pois){
     if(p.position.latitude<minLat||p.position.latitude>maxLat||p.position.longitude<minLon||p.position.longitude>maxLon)continue;
     TreeMap<String,String> tags=new TreeMap<>();for(Tag t:p.tags)tags.put(t.key,t.value);
     if(!tags.containsKey("name"))continue;
     StringBuilder line=new StringBuilder("{\"coordinate\":[").append(p.position.longitude).append(',').append(p.position.latitude).append("],\"tags\":{");boolean first=true;
     for(Map.Entry<String,String> e:tags.entrySet()){if(!first)line.append(',');first=false;line.append(q(e.getKey())).append(':').append(q(e.getValue()));}
     out.println(line.append("}}"));count++;
    }
   }
  }
  file.close();System.err.println("named POIs="+count);
 }
}

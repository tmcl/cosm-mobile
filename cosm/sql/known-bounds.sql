with known as (select min(observed) observed, st_union(geom) known from bounds where observed > datetime('now', '-7 day') union select '2024-01-01 01:01:01', st_envelope(makepoint(0, 0)) )
select 
  max(observed), 
  $minlon as minlon, 
  asgeojson(known.known) as unio, 
  asgeojson(st_difference(st_envelope(makeline(makepoint($minlon, $minlat, 4326), makepoint($maxlon, $maxlat, 4326))), known.known), 15, 1) as difference
from known 
where known.known is not null

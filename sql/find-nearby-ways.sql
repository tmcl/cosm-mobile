select
  cast(id as text) as id,
  properties -> 'tags',
  asgeojson(geombuffered),
  st_distance(ways.geomgda, transform(llpoint, 7855)) - width/2 as dist,
  line_locate_point(ways.geom, llpoint) as located,
  asgeojson(line_interpolate_point(ways.geom, line_locate_point(ways.geom, llpoint))) as nearest
from ways
  join (select makepoint($lon, $lat, 4326) as llpoint) as point
where dist < 5
and rowid in (
    select rowid
    from SpatialIndex
    where f_table_name = 'ways'
    and f_geometry_column = 'geombuffered'
    and search_frame = st_envelope(makeline(makepoint($minlon, $minlat, 4326), makepoint($maxlon, $maxlat, 4326)))

    )
limit 5
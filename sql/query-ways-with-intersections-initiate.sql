WITH
    relatedways AS (
        SELECT ways.*
        FROM ways
        WHERE (st_EnvelopesIntersects(ways.geombuffered, $minlon, $minlat, $maxlon, $maxlat)
            and
               ways.rowid in (select rowid
                              from SpatialIndex
                              where f_table_name = 'ways'
                                and f_geometry_column = 'geombuffered'
                                and search_frame = st_envelope(makeline(makepoint($minlon, $minlat, 4326),
                                                                        makepoint($maxlon, $maxlat, 4326)))))
           or ways.id in (select atom from json_each($required_ids) where atom is not null))

select cast(ways.id as text) as id
from relatedways as ways
group by ways.id
limit 1000
select cast(ways.id as text) as id,
       ways_of_same_roads.road as sameRoad
from ways
         join json_each(ways.nodes) n
         left join ways_of_same_roads on ways_of_same_roads.way_id = ways.id
    where ways.id in (select cast(atom as number) from json_each($required_ids) where atom is not null)
group by ways.id
limit 1000
with output as (select *, coalesce(lead(node_id) over ordered_way, node_id) as next, coalesce(lag(node_id) over ordered_way, node_id) as prev from nodes_ways window ordered_way as (partition by way_id, version order by way_id, ordering))
  select output.*, 
  asgeojson(next.geom) as nextgeom,
  asgeojson(prev.geom) as prevgeom
  from output 
  join nodes next on output.next = next.id
  join nodes prev on output.prev = prev.id
  where node_id = $node_id and way_id = $way_id
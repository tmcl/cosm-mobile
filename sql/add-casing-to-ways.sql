with bufferedways as (
    select
        id,
        buffer(geomgda, width/2.0) as geombufferedgda
    from ways
    where geombufferedgda is null and geomgda is not null
    limit 15
)
update ways
  set geombufferedgda = bufferedways.geombufferedgda,
      geombuffered = transform(bufferedways.geombufferedgda, 4326)
  from bufferedways
  where bufferedways.id = ways.id
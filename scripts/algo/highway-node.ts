import { WayId } from "@/components/types";
import { NearestPoint } from "@/components/diff-info";
import type { Feature, LineString } from "geojson";
import { IWay } from "@/scripts/clients";
import * as turf from "@turf/turf";

export type NewPoint = { type: "new"; way: WayId; point: NearestPoint };

export const mkNewHighwayNode = (
  wayId: WayId,
  wayCentrelines: Record<WayId, Feature<LineString, IWay>>,
  relativePoint: GeoJSON.Position | GeoJSON.Point
): NewPoint | undefined => {
  const closestPoints = Object.entries(wayCentrelines).flatMap(
    ([localWayId, way]) => {
      if (!way) return [];
      const closestPoint = turf.nearestPointOnLine(way, relativePoint);
      closestPoint.id = `derived-${wayId}`;
      closestPoint.properties = {
        ...closestPoint.properties,
        distance: turf.distance(relativePoint, closestPoint),
        triggeringWayId: wayId,
        segmentWayId: localWayId,
      };
      return [closestPoint];
    }
  );
  if (closestPoints.length === 0) {
    console.log(wayId, closestPoints);
    return undefined;
  }
  const closestPoint = closestPoints.sort(
    (f, g) => f.properties.distance - g.properties.distance
  )[0];
  const bestPoint: NearestPoint = {
    ...closestPoint,
    properties: {
      dist: closestPoint.properties.dist,
      location: closestPoint.properties.location,
      triggeringWayId: closestPoint.properties.triggeringWayId,
      segmentWayId: closestPoint.properties.segmentWayId,
      index: closestPoint.properties.index,
    },
  };
  const way: WayId = bestPoint.properties.segmentWayId;

  return { type: "new" as const, way: way, point: bestPoint };
};

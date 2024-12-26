import fromAsync from 'array-from-async';
import * as SQLite from 'expo-sqlite'
import type GeoJSON from "geojson";
import * as OsmApi from "@/scripts/clients";
import {InteractionManager} from "react-native";
import * as ReactQuery from "@tanstack/react-query";
import {useEffect, useRef} from "react";
import {useDrizzleStudio} from "expo-drizzle-studio-plugin";
import type {DefaultError} from "@tanstack/query-core";

export type QueryWaysWithIntersections = {
  parsedCasings: GeoJSON.Feature<GeoJSON.Polygon, OsmApi.IWay>[]
  parsedCentrelines: GeoJSON.Feature<GeoJSON.LineString, OsmApi.IWay>[]
  parsedOthers: Record<WayId, IntersectingWayInfo>
  parsedSameRoad: Record<WayId, WayId<number>[]>
}

export type TargetNode = GeoJSON.Feature<GeoJSON.Point, { ways: string[] } & OsmApi.INode>

export class EditPageQueries {
  private _queryWaysWithIntersections: SQLite.SQLiteStatement | undefined
  private _findNearbyWays: SQLite.SQLiteStatement | undefined
  private _findTargetNodes: SQLite.SQLiteStatement | undefined
  private _findAnglePointsForWayPoint: SQLite.SQLiteStatement | undefined

  private _tracker;

  constructor() {
    this._tracker = new ThingyTracker()
  };

  // noinspection JSUnusedGlobalSymbols this shouldn't be used - it exists to create a type error if it is
  public get findAnglePointsForWayPoint(): never { throw "use the do- method" }

  public set findAnglePointsForWayPoint(theQueryWays: SQLite.SQLiteStatement | undefined) {
    this._findAnglePointsForWayPoint?.finalizeAsync()
    this._findAnglePointsForWayPoint = theQueryWays
  }

  public async doFindAnglePointsForWayPoint(args: { $way_id: number, $node_id: number }): Promise<{
    next: GeoJSON.Point,
    prev: GeoJSON.Point
  } | undefined> {
    const answer = await this._findAnglePointsForWayPoint!.executeAsync<{ nextgeom: string, prevgeom: string }>(args)
    const first = await answer.getFirstAsync()
    const final = first && {next: JSON.parse(first.nextgeom), prev: JSON.parse(first.prevgeom)}
    return final || undefined
  }

  // noinspection JSUnusedGlobalSymbols this shouldn't be used - it exists to create a type error if it is
  public get findTargetNodes(): never { throw "use the do- method" }

  public set findTargetNodes(theQueryWays: SQLite.SQLiteStatement | undefined) {
    this._findTargetNodes?.finalizeAsync()
    this._findTargetNodes = theQueryWays
  }

  public async doFindTargetNodes(jsArgs: {
    $needle: Record<string, string>,
    minlon: number,
    minlat: number,
    maxlon: number,
    maxlat: number
  }) {
    const {minlon, minlat, maxlon, maxlat} = jsArgs
    const argsModified = {
      $minlon: minlon,
      $minlat: minlat,
      $maxlat: maxlat,
      $maxlon: maxlon,
      $needles: JSON.stringify([jsArgs.$needle])
    }
    const r = await this._findTargetNodes!.executeAsync<{ geojson: string, ways: string }>(argsModified)
    const r2 = await r.getAllAsync()
    return r2.map(geo => {
      return JSON.parse(geo.geojson) as TargetNode
    })
  }

  public set queryWaysWithIntersections(complete: SQLite.SQLiteStatement | undefined) {
    this._queryWaysWithIntersections?.finalizeAsync()
    this._queryWaysWithIntersections = complete
  }

  public async doQueryWaysWithIntersections(jsArgs: {
    $required_ids: WayId[],
    minlon: number,
    minlat: number,
    maxlon: number,
    maxlat: number
  }): Promise<QueryWaysWithIntersections> {
    const {minlon, minlat, maxlon, maxlat} = jsArgs
    const allAtOnce = async () => {
      console.log("wanting to query aow")

      const serialArgs = {
        $minlon: minlon,
        $minlat: minlat,
        $maxlat: maxlat,
        $maxlon: maxlon,
        $required_ids: JSON.stringify(jsArgs.$required_ids)
      }
      const waysResult1 = await this._tracker.track(
          "raw query",
          () => this._queryWaysWithIntersections!.executeAsync<{
            length: number | null,
            geojson: string,
            centreline: string,
            other_ways: string,
            sameroad: string
          }>(serialArgs),
          true
      )
      const waysResult = waysResult1.res
      console.log("//////waysresult raw query", waysResult1.times)
      try {
        const geo_ = await this._tracker.track("fetch query", () => waysResult.getFirstAsync(), true)
        const geo = geo_.res
        console.log("+++ fetch query", geo_.times)

        const result = await this._tracker.track("parse query", async () => {
          const parsedCasings: GeoJSON.Feature<GeoJSON.Polygon, OsmApi.IWay>[] = geo ? JSON.parse(geo.geojson) : []
          const parsedCentrelines: GeoJSON.Feature<GeoJSON.LineString, OsmApi.IWay>[] = geo
              ? JSON.parse(geo.centreline)
              : []
          const parsedOthers: Record<WayId, IntersectingWayInfo> = geo ? JSON.parse(geo.other_ways) : {}
          const parsedSameRoad: Record<WayId, WayId<number>[]> = geo ? JSON.parse(geo.sameroad) : {}
          return {parsedCasings, parsedCentrelines, parsedOthers, parsedSameRoad}
        }, true)

        console.log("+++parse query", result.times)

        return result.res

      } catch (e) {
        console.log("there was an error hereabouts", e)
        throw e
      }
    }

    const aow = await this._tracker.track("*****all at once", allAtOnce, true)

    console.log("********************times", "all at once", aow.times, ((aow.times.end || 0) - aow.times.ts) / 1000)

    return aow.res
  }

  // noinspection JSUnusedGlobalSymbols this shouldn't be used - it exists to create a type error if it is
  public get findNearbyWays(): never { throw "this._findNearbyWays" }

  public set findNearbyWays(thequery: SQLite.SQLiteStatement | undefined) {
    this._findNearbyWays?.finalizeAsync()
    this._findNearbyWays = thequery
  }

  async setup(db: SQLite.SQLiteDatabase) {
    this.findNearbyWays = await db.prepareAsync(require('@/sql/find-nearby-ways.sql.json'))
    this.queryWaysWithIntersections = await db.prepareAsync(require(
        '@/sql/query-ways-with-intersections-all-at-once.sql.json'))
    this.findTargetNodes = await db.prepareAsync(require('@/sql/find-target-elements.sql.json'))
    this.findAnglePointsForWayPoint = await db.prepareAsync(require('@/sql/find-angle-points-for-way-point.sql.json'))
  }

  finalize() {
    this.findNearbyWays = undefined
    this.queryWaysWithIntersections = undefined
    this.findTargetNodes = undefined
    this.findAnglePointsForWayPoint = undefined
  }
}

type TrackerInfo = {
  any: any,
  ts: number,
  state: "waiting" | "finished" | "failed",
  end?: number,
  e?: any,
  seconds?: number
}

class ThingyTracker {
  private _trackees: TrackerInfo[] = []
  private _timeout: number | undefined

  public async track<T, R>(arg: T, f: (arg: T) => Promise<R>): Promise<R> ;
  public async track<T, R>(arg: T, f: (arg: T) => Promise<R>, withTimes: false): Promise<R> ;
  public async track<T, R>(arg: T, f: (arg: T) => Promise<R>, withTimes: true): Promise<{
    res: R,
    times: TrackerInfo
  }> ;
  public async track<T, R>(arg: T, f: (arg: T) => Promise<R>, withTimes = false) {
    const newLength = this._trackees.push({any: arg, ts: new Date().getTime(), state: "waiting"})
    const i = newLength - 1
    this.checktimeout()

    try {
      const r = await f(arg)
      this._trackees[i].state = "finished"
      this._trackees[i].end = new Date().getTime()
      this._trackees[i].seconds = (this._trackees[i].end - this._trackees[i].ts) / 1000
      console.log(this._trackees[i])
      if (withTimes) {
        return {res: r, times: this._trackees[i]}
      } else {
        return r
      }
    } catch (e) {
      this._trackees[i].state = "failed"
      this._trackees[i].end = new Date().getTime()
      this._trackees[i].seconds = (this._trackees[i].end - this._trackees[i].ts) / 1000
      this._trackees[i].e = e
      console.log(this._trackees[i])
      throw e
    }
  }

  public checktimeout() {
    if (this._timeout) return
    let interval: number;
    interval = setInterval(() => {
      const now = new Date().getTime()
      let current
      if (this._timeout
          === interval
          && (current = this._trackees.filter(f => f.state === "waiting"))
          && current?.length) {
        console.log("waiting jobs", current.length)
        const old = current.flatMap(f => {
              const duration = f.ts < now - 1_000
              if (duration) {
                return [{...f, seconds: (now - f.ts) / 1000}]
              } else
                return []
            }
        )
        console.log("including the following old ones", old)
      } else {
        if (this._timeout === interval) {
          this._timeout = undefined
        }
        clearInterval(interval)
      }
    }, 1_000) as any
    this._timeout = interval
  }
}

export type InterestingNodes = GeoJSON.FeatureCollection<GeoJSON.Point, object>
export type InterestingNodesParams = {
  $needles: Record<string, string>[],
  minlon: number,
  minlat: number,
  maxlon: number,
  maxlat: number
}

type StatementOrError = { q: SQLite.SQLiteStatement } | { e: unknown }

export type SavedChangeSet<JSON = object> =
    {
      id: number,
      type: string,
      state_extract: JSON,
      change: JSON,
      created_date: number,
      modified_date: number | null,
      ready_date: number | null,
      commit_date: number | null,
      commentary1: string | null,
      commentary2: string | null,
    }
export type ChangeSet =
    {
      type: string,
      state_extract: object,
      change: object
    }

export class MainPageQueries {
  private _knownBounds: SQLite.SQLiteStatement | undefined
  private _insertBounds: SQLite.SQLiteStatement | undefined
  private _insertNodes: SQLite.SQLiteStatement | undefined
  private _insertRelatedWays: SQLite.SQLiteStatement | undefined
  private _insertNodesWays: SQLite.SQLiteStatement | undefined
  private _queryNodes: SQLite.SQLiteStatement | undefined
  private _insertWays: SQLite.SQLiteStatement | undefined
  private _queryWays: StatementOrError | undefined
  private _findNearbyWays: SQLite.SQLiteStatement | undefined
  private _addCasingsToWays: SQLite.SQLiteStatement | undefined
  private _findSameRoads: SQLite.SQLiteStatement | undefined
  private _findIntersections: SQLite.SQLiteStatement | undefined
  private _findTargetNodes: StatementOrError | undefined
  private _saveNewChange: StatementOrError | undefined
  private _saveUpdateChange: StatementOrError | undefined
  private _selectUserChange: StatementOrError | undefined

  private _tracker;

  constructor() {
    this._tracker = new ThingyTracker()
  };

  // noinspection JSUnusedGlobalSymbols this shouldn't be used - it exists to create a type error if it is
  public get selectUserChange(): never { throw "use the do- method" }

  public set selectUserChange(theQuery: StatementOrError | undefined) {
    this._selectUserChange && "q" in this._selectUserChange && this._selectUserChange.q.finalizeAsync()
    this._selectUserChange = theQuery
  }

  public async doselectUserChange(id: number): Promise<SavedChangeSet | null> {
    console.log("doing select user change", this._selectUserChange)
    if (this._selectUserChange && "q" in this._selectUserChange) {
      const sqlChange = {$id: id,}
      const r = await this._selectUserChange.q.executeAsync<SavedChangeSet<string>>(sqlChange)
      const res = (await r.getFirstAsync())
      const result = res && {...res, state_extract: JSON.parse(res.state_extract), change: JSON.parse(res.change)}
      console.log("didding select user change", res, result)
      return result
    } else {
      throw (this._selectUserChange || "select user change was not defined")
    }
  }

  // noinspection JSUnusedGlobalSymbols this shouldn't be used - it exists to create a type error if it is
  public get saveUpdateChange(): never { throw "use the do- method" }

  public set saveUpdateChange(theQuery: StatementOrError | undefined) {
    this._saveUpdateChange && "q" in this._saveUpdateChange && this._saveUpdateChange.q.finalizeAsync()
    this._saveUpdateChange = theQuery
  }

  public async doSaveUpdateChange(id: number, changeset: ChangeSet, commentary: [string, string|undefined]): Promise<number> {
    if (this._saveUpdateChange && "q" in this._saveUpdateChange) {
      const sqlChange = {
        $id: id,
        $type: changeset.type,
        $state_extract: JSON.stringify(changeset.state_extract),
        $change: JSON.stringify(changeset.change),
        $commentary1: commentary[0],
        $commentary2: commentary[1] || null
      }
      const r = await this._saveUpdateChange.q.executeAsync<SavedChangeSet>(sqlChange)
      return r.changes
    } else {
      throw this._saveUpdateChange || "save Update change was not defined"
    }
  }

  // noinspection JSUnusedGlobalSymbols this shouldn't be used - it exists to create a type error if it is
  public get saveNewChange(): never { throw "use the do- method" }

  public set saveNewChange(theQuery: StatementOrError | undefined) {
    this._saveNewChange && "q" in this._saveNewChange && this._saveNewChange.q.finalizeAsync()
    this._saveNewChange = theQuery
  }

  public async doSaveNewChange(changeset: ChangeSet): Promise<SavedChangeSet> {
    if (this._saveNewChange && "q" in this._saveNewChange) {
      const sqlChange = {
        $type: changeset.type,
        $state_extract: JSON.stringify(changeset.state_extract),
        $change: JSON.stringify(changeset.change),
      }
      const r = await this._saveNewChange.q.executeAsync<SavedChangeSet>(sqlChange)
      return (await r.getFirstAsync())!
    } else {
      throw this._saveNewChange || "save new change was not defined"
    }
  }

  public get findTargetNodes(): never { throw "use the do- method" }

  public set findTargetNodes(theQueryWays: StatementOrError | undefined) {
    this._findTargetNodes && "q" in this._findTargetNodes && this._findTargetNodes.q.finalizeAsync()
    this._findTargetNodes = theQueryWays
  }

  public async doFindTargetNodes(jsArgs: InterestingNodesParams): Promise<InterestingNodes> {
    if (this._findTargetNodes && "q" in this._findTargetNodes) {
      const {minlon, minlat, maxlon, maxlat} = jsArgs
      const argsModified = {
        $minlon: minlon,
        $minlat: minlat,
        $maxlat: maxlat,
        $maxlon: maxlon,
        $needles: JSON.stringify(jsArgs.$needles)
      }
      const r = await this._findTargetNodes.q.executeAsync<{ geojson: string, ways: string }>(argsModified)
      const r2 = await r.getAllAsync()
      //console.log("i found target nodes", r2, "target nodes gefunden habe ich")
      const targetNodes = r2.map(geo => {
        return JSON.parse(geo.geojson) as TargetNode
      })
      return {
        type: "FeatureCollection",
        features: targetNodes
      }
    } else {
      throw this._findTargetNodes || "find target nodes was not defined"
    }
  }

  // noinspection JSUnusedGlobalSymbols this shouldn't be used - it exists to create a type error if it is
  public get knownBounds(): never { throw "use the do function" }

  public set knownBounds(theneededareas: SQLite.SQLiteStatement | undefined) {
    this._knownBounds?.finalizeAsync()
    this._knownBounds = theneededareas
  }

  public async doKnownBounds(jsArgs: { minlon: number, minlat: number, maxlon: number, maxlat: number }) {
    const {minlon, minlat, maxlon, maxlat} = jsArgs
    const sqliteArgs = {$minlon: minlon, $minlat: minlat, $maxlat: maxlat, $maxlon: maxlon}
    const boundsQuer = await this._knownBounds!.executeAsync<{ difference: string }>(sqliteArgs)
    const boundsStr = await boundsQuer.getFirstAsync()
    return JSON.parse(boundsStr!.difference) as GeoJSON.Polygon | null
  }

  // noinspection JSUnusedGlobalSymbols this shouldn't be used - it exists to create a type error if it is
  public get queryNodes(): never { throw "this._queryNodes" }

  public set queryNodes(theQueryNodes: SQLite.SQLiteStatement | undefined) {
    this._queryNodes?.finalizeAsync()
    this._queryNodes = theQueryNodes
  }

  public async* doQueryNodes(jsArgs: { minlon: number, minlat: number, maxlon: number, maxlat: number }) {
    const {minlon, minlat, maxlon, maxlat} = jsArgs
    const sqliteArgs = {$minlon: minlon, $minlat: minlat, $maxlat: maxlat, $maxlon: maxlon}
    const result = await this._queryNodes!.executeAsync<{ geojson: string }>(sqliteArgs)
    for await (const geojson of result) {
      yield JSON.parse(geojson.geojson) as GeoJSON.Feature<GeoJSON.Point, OsmApi.INode>
    }
  }

  public set queryWays(theQueryWays: { q: SQLite.SQLiteStatement } | { e: unknown } | undefined) {
    this._queryWays && "q" in this._queryWays && this._queryWays.q.finalizeAsync()
    this._queryWays = theQueryWays
  }

  public async doQueryWays(jsArgs: { $limit: number, minlon: number, minlat: number, maxlon: number, maxlat: number }) {
    if (this._queryWays && "q" in this._queryWays) {
      const {minlon, minlat, maxlon, maxlat, ...others} = jsArgs
      const sqliteArgs = {...others, $minlon: minlon, $minlat: minlat, $maxlat: maxlat, $maxlon: maxlon}
      const result = this._queryWays.q.executeSync<{ geojson: string, centrelines: string }>(sqliteArgs)
      const centrelines = []
      const casings = []
      for await (const geojson of result) {
        casings.push(JSON.parse(geojson.geojson) as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.LineString, OsmApi.IWay>)
        centrelines.push(JSON.parse(geojson.centrelines) as GeoJSON.Feature<GeoJSON.LineString, OsmApi.IWay>)
      }
      return {centrelines, casings}
    } else {
      throw JSON.stringify(this._queryWays) || "query ways not defined"
    }
  }

  // noinspection JSUnusedGlobalSymbols this shouldn't be used - it exists to create a type error if it is
  public get insertNodesWays(): never { throw "use the do function" }

  public set insertNodesWays(theinsertWays: SQLite.SQLiteStatement | undefined) {
    this._insertNodesWays?.finalizeAsync()
    this._insertNodesWays = theinsertWays
  }

  public get insertRelatedWays() { return this._insertRelatedWays }

  public set insertRelatedWays(theinsertWays: SQLite.SQLiteStatement | undefined) {
    this._insertRelatedWays?.finalizeAsync()
    this._insertRelatedWays = theinsertWays
  }

  public doInsertRelatedWays() {
    const loop = async (changes: number, resolver: (val: number) => void) => {
      const currentQuery = this._insertRelatedWays
      const queryResult = await this._tracker.track("insert related ways", () => currentQuery!.executeAsync<never>())
      console.log("irw queryResult.changes", queryResult.changes)
      if (queryResult.changes) {
        InteractionManager.runAfterInteractions(() => loop(changes + queryResult.changes, resolver))
      } else {
        resolver(changes)
      }
    }
    const settler = (resolver: (val: number) => void, rejecter: (e?: any) => void) => {
      loop(0, resolver)
    }
    return new Promise<number>(settler)
  }

  // noinspection JSUnusedGlobalSymbols this shouldn't be used - it exists to create a type error if it is
  public get addCasingToWays(): never { throw "use the do function" }

  public set addCasingToWays(thequery: SQLite.SQLiteStatement | undefined) {
    this._addCasingsToWays?.finalizeAsync()
    this._addCasingsToWays = thequery
  }


  public doAddCasingToWays() {
    return this._addCasingsToWays!.executeAsync<never>()
  }

  // noinspection JSUnusedGlobalSymbols this shouldn't be used - it exists to create a type error if it is
  public get insertWays(): never { throw "use the do function" }

  public set insertWays(theinsertWays: SQLite.SQLiteStatement | undefined) {
    this._insertWays?.finalizeAsync()
    this._insertWays = theinsertWays
  }

  public doInsertWays(param: { $json: string }) {
    const r1 = this._tracker.track("insert ways", async _ => this._insertWays!.executeAsync<never>(param))
    const r2 = this._tracker.track("insert nodes ways", async _ => this._insertNodesWays!.executeAsync<never>(param))
    return fromAsync([r1, r2])
  }

  // noinspection JSUnusedGlobalSymbols this shouldn't be used - it exists to create a type error if it is
  public get insertNodes(): never { throw "this._insertNodes" }

  public set insertNodes(theinsertNodes: SQLite.SQLiteStatement | undefined) {
    this._insertNodes?.finalizeAsync()
    this._insertNodes = theinsertNodes
  }

  public doInsertNodes(param: { $json: string }) {
    return this._tracker.track("insertNodes", async _ => {
      return this._insertNodes!.executeAsync<never>(param)
    })
  }


  // noinspection JSUnusedGlobalSymbols this shouldn't be used - it exists to create a type error if it is
  public get findIntersections(): never { throw "this._findIntersections" }

  public set findIntersections(thequery: SQLite.SQLiteStatement | undefined) {
    this._findIntersections?.finalizeAsync()
    this._findIntersections = thequery
  }

  public async doFindIntersections(jsArgs: WayId[]): Promise<Record<WayId, IntersectingWayInfo>> {
    const sqliteArgs = {$required_ids: JSON.stringify(jsArgs)}
    console.log("find intersections", jsArgs, sqliteArgs)
    const query = await this._tracker.track(
        "exec find intersections",
        () => this._findIntersections!.executeAsync<{ intersections: string }>(sqliteArgs)
    )
    const queryResult = await this._tracker.track("exec getall intersections", () => query.getFirstAsync())
    const result: Record<WayId, IntersectingWayInfo> = queryResult
        ? JSON.parse(queryResult.intersections)
        : {}
    console.log("intersections res", queryResult, result)
    return result
  }

  // noinspection JSUnusedGlobalSymbols this shouldn't be used - it exists to create a type error if it is
  public get findSameRoads(): never { throw "this._findSameRoads" }

  public set findSameRoads(thequery: SQLite.SQLiteStatement | undefined) {
    this._findSameRoads?.finalizeAsync()
    this._findSameRoads = thequery
  }

  public async doFindSameRoads(jsArgs: WayId[]): Promise<Record<WayId, WayId[]>> {
    const sqliteArgs = {$required_ids: JSON.stringify(jsArgs)}
    console.log("!!!!!!!!!!!!!!!!!!!!!!!!!find same roads", jsArgs, sqliteArgs)
    const query = await this._tracker.track(
        "exec find sameRoads",
        () => this._findSameRoads!.executeAsync<{ id: WayId, sameRoad: string }>(sqliteArgs)
    )
    const queryResult = await this._tracker.track("exec getall same roads", () => query.getAllAsync())
    const result: Record<WayId, WayId[]> = {}
    queryResult.forEach(r => {result[r.id] = (JSON.parse(r.sameRoad) as number[]).map(m => m.toString())})
    console.log("same road res", queryResult, result)
    if (Object.values(result).some(s => s.some(t => typeof t !== "string"))) {
      console.log("%%%%%%%%%%%%0, this is wrong")
    }

    return result
  }

  // noinspection JSUnusedGlobalSymbols this shouldn't be used - it exists to create a type error if it is
  public get findNearbyWays(): never { throw "this._findNearbyWays" }

  public set findNearbyWays(thequery: SQLite.SQLiteStatement | undefined) {
    this._findNearbyWays?.finalizeAsync()
    this._findNearbyWays = thequery
  }

  public async doFindNearbyWays(jsArgs: {
    "$lat": number,
    "$lon": number,
    "minlon": number,
    "minlat": number,
    "maxlon": number,
    "maxlat": number
  }): Promise<FoundNearbyWays> {
    const {minlon, minlat, maxlon, maxlat, ...corrected} = jsArgs
    const sqliteArgs = {...corrected, $minlon: minlon, $minlat: minlat, $maxlat: maxlat, $maxlon: maxlon}
    const query = await this._tracker.track(
        "exec find nearby ways",
        () => this._findNearbyWays!.executeAsync<{ dist: number, id: string, nearest: string }>(sqliteArgs)
    )
    const queryResult = await this._tracker.track("exec getall nearby ways", () => query.getAllAsync())
    const result = {ways: new Array<string>(queryResult.length), nodes: new Array<GeoJSON.Point>(queryResult.length)}
    queryResult.forEach((r, ix) => {
      result.ways[ix] = r.id;
      result.nodes[ix] = JSON.parse(r.nearest)
    })
    return result
  }

  // noinspection JSUnusedGlobalSymbols this shouldn't be used - it exists to create a type error if it is
  public get insertBounds(): never { throw "this._insertBounds" }

  public set insertBounds(theinsertBounds: SQLite.SQLiteStatement | undefined) {
    this._insertBounds?.finalizeAsync()
    this._insertBounds = theinsertBounds
  }

  public async doInsertBounds(args: { $json: string, $requestedBounds: JsonBBox }) {
    const param = {$json: JSON.stringify({bounds: args.$requestedBounds})}
    return this._tracker.track("insert bounds", async _ => {
      return await this._insertBounds!.executeAsync<never>(param)
    })
  }

  async setup(db: SQLite.SQLiteDatabase) {
    this.findNearbyWays = await db.prepareAsync(require('@/sql/find-nearby-ways.sql.json'))
    this.insertBounds = await db.prepareAsync(require('@/sql/insert-bounds.sql.json'))
    this.insertNodes = await db.prepareAsync(require('@/sql/insert-nodes.sql.json'))
    this.insertWays = await db.prepareAsync(require('@/sql/insert-ways.sql.json'))
    this.knownBounds = await db.prepareAsync(require('@/sql/known-bounds.sql.json'))
    this.addCasingToWays = await db.prepareAsync(require('@/sql/add-casing-to-ways.sql.json'))
    this.insertRelatedWays = await db.prepareAsync(require('@/sql/insert-related-ways.sql.json'))

    this.insertNodesWays = await db.prepareAsync(require('@/sql/insert-nodes-ways.sql.json'))
    this.queryNodes = await db.prepareAsync(require('@/sql/query-nodes.sql.json'))
    this.queryWays = await (async () => { try { return {q: await db.prepareAsync(require('@/sql/query-ways.sql.json'))} } catch (e) { return {e: e} }})()
    this.findSameRoads = await db.prepareAsync(require('@/sql/find-same-roads.sql.json'))
    this.findIntersections = await db.prepareAsync(require('@/sql/find-intersections.sql.json'))
    this.findTargetNodes = await (async () => {
      try {
        return {
          q: await db.prepareAsync(require('@/sql/find-target-elements.sql.json'))
        }
      } catch (e) { return {e: e} }
    })()
    this.saveNewChange = await (async () => {
      try {
        return {
          q: await db.prepareAsync(require('@/sql/save-user-data-changes.sql.json'))
        }
      } catch (e) { return {e: e} }
    })()
    this.saveUpdateChange = await (async () => {
      try {
        return {
          q: await db.prepareAsync(require('@/sql/update-user-data-changes.sql.json'))
        }
      } catch (e) { return {e: e} }
    })()
    this.selectUserChange = await (async () => {
      try {
        return {
          q: await db.prepareAsync(require('@/sql/select-user-change.sql.json'))
        }
      } catch (e) { return {e: e} }
    })()
  }

  finalize() {
    this.knownBounds = undefined
    this.insertBounds = undefined
    this.findNearbyWays = undefined
    this.insertNodes = undefined
    this.insertNodesWays = undefined
    this.queryNodes = undefined
    this.insertWays = undefined
    this.addCasingToWays = undefined
    this.insertRelatedWays = undefined
    this.queryWays = undefined
    this.findSameRoads = undefined
    this.findTargetNodes = undefined
    this.findIntersections = undefined
    this.saveNewChange = undefined
    this.saveUpdateChange = undefined
    this.selectUserChange = undefined
  }
}

export const zip = function <A, B>(aa: A[], bb: B[]): [A, B][] {
  const answer: [A, B][] = []
  for (let i = 0; i < aa.length; i++) {
    if (!bb.hasOwnProperty(i)) { break; }

    answer.push([aa[i], bb[i]])
  }
  return answer
}

export type JsonBBox = { minlon: number, minlat: number, maxlat: number, maxlon: number }

export type IntersectingWayInfo = {
  ix: number,
  node_tags: OsmApi.INode,
  others: WayId<number>,
  way_tags: OsmApi.IWay
}[]

export function doublePad(bbox: JsonBBox): JsonBBox
export function doublePad({minlon, minlat, maxlon, maxlat}: JsonBBox): JsonBBox {
  minlon = minlon - (maxlon - minlon)
  maxlon = maxlon + (maxlon - minlon)
  minlat = minlat - (maxlat - minlat)
  maxlat = maxlat + (maxlat - minlat)
  return {minlon, minlat, maxlon, maxlat}
}

type AppKey = readonly unknown[]

export type StandardQuery<T, TError, TResult> = Parameters<typeof ReactQuery.useQuery<T, TError, TResult, AppKey>>
export type QueryState<TError, TResult> =
    { status: 'error', fetchStatus: 'fetching' | 'paused' | 'idle', data: TResult | undefined, error: TError }
    | {
  status: 'pending',
  fetchStatus: 'fetching' | 'paused' | 'idle',
  data: TResult | undefined,
  error: TError | null
}
    | { status: 'success', fetchStatus: 'fetching' | 'paused' | 'idle', data: TResult, error: TError | null }
export const initialQueryState = <TError, TResult>(): QueryState<TError, TResult> => ({
  status: 'pending',
  fetchStatus: 'idle',
  data: undefined,
  error: null
})
export type QueryDispatcher<TError, TResult> = (args: QueryState<TError, TResult>) => void
export const useDispatchingQuery =
    function <TError, TResult>(
        dispatcher: QueryDispatcher<TError, TResult>,
        ...args: StandardQuery<TResult, TError, TResult>
    ) {
      const query = ReactQuery.useQuery(...args)
      const queryStatus = query.status
      useEffect(() => {
        // noinspection JSUnreachableSwitchBranches webstorm overenthusiastic?
        switch (queryStatus) {
          case "error":
            return dispatcher({
              status: query.status,
              fetchStatus: query.fetchStatus,
              data: query.data,
              error: query.error
            })
          case "success":
            return dispatcher({
              status: query.status,
              fetchStatus: query.fetchStatus,
              data: query.data,
              error: query.error
            })
          case "pending":
            return dispatcher({
              status: query.status,
              fetchStatus: query.fetchStatus,
              data: query.data,
              error: query.error
            })
          default:
            unreachable(queryStatus)
        }
      }, [queryStatus, query.status, query.fetchStatus, query.data, query.error, dispatcher])
    }

export type MutationState<TError, TResult> =
    { status: 'error', data: TResult | undefined, error: TError }
    | { status: 'idle', data: TResult | undefined, error: TError | null }
    | { status: 'pending', data: TResult | undefined, error: TError | null }
    | { status: 'success', data: TResult, error: TError | null }
export const initialMutationState = <TError, TResult>(): MutationState<TError, TResult> => ({
  status: 'idle',
  data: undefined,
  error: null
})
export type StandardMutation<
    TData = unknown,
    TError = DefaultError,
    TVariables = void,
    TContext = unknown,
> = Parameters<typeof ReactQuery.useMutation<TData, TError, TVariables, TContext>>
export type MutationDispatcher<TError, TResult> = (args: MutationState<TError, TResult>) => void
export const useDispatchingMutation =
    function <TData, TError, TVariables = void, TContext = unknown>(
        dispatcher: MutationDispatcher<TError, TData>, ...args: StandardMutation<TData, TError, TVariables, TContext>) {
      const mutation = ReactQuery.useMutation(...args)
      const mutationStatus = mutation.status
      useEffect(() => {
        // noinspection JSUnreachableSwitchBranches webstorm overenthusiastic?
        switch (mutationStatus) {
          case "idle":
            return dispatcher({status: mutation.status, data: mutation.data, error: mutation.error})
          case "error":
            return dispatcher({status: mutation.status, data: mutation.data, error: mutation.error})
          case "success":
            return dispatcher({status: mutation.status, data: mutation.data, error: mutation.error})
          case "pending":
            return dispatcher({status: mutation.status, data: mutation.data, error: mutation.error})
          default:
            unreachable(mutationStatus)
        }
      }, [mutationStatus, mutation.status, mutation.data, mutation.error, dispatcher])
      return mutation
    }

class ReviewPageQueries {
  private _db: SQLite.SQLiteDatabase | undefined

  setup(db: SQLite.SQLiteDatabase) {
    this._db = db
  }

  finalize() {
    this._db = undefined
  }

  async queryChanges() {
    const sql = await this._db!.prepareAsync(require('@/sql/select-user-changes.sql.json'))
    const query = await sql.executeAsync<SavedChangeSet>();
    return await query.getAllAsync()
  }
}

export const useReviewPageQueries = () => {
  const db = SQLite.useSQLiteContext()
  const queries = useRef(new ReviewPageQueries())
  useEffect(() => {
    const currentQueries = queries.current
    currentQueries.setup(db)
    return () => currentQueries.finalize()
  }, [db])
  return queries
}
export const useMainPageQueries = () => {
  const db = SQLite.useSQLiteContext()
  const queries = useRef(new MainPageQueries())
  useDrizzleStudio(db)
  useEffect(() => {
    const currentQueries = queries.current
    currentQueries.setup(db)
    return () => currentQueries.finalize()
  }, [db])
  return queries
}
export type FoundNearbyWays = { ways: WayId[], nodes: GeoJSON.Point[] }


export const debug = (a: any, b: any) => {
  console.log(a, b);
  return b
}
export type WayId<T extends string | number = string> = T

export const nub = (arr: string[]): string[] => {
  return Object.keys(Object.fromEntries(arr.map(f => [f, true])))
}

export const containsAny = <T>(haystack: T[], needles: T[]): boolean => {
  return needles.some(needle => haystack.includes(needle))
}

export const containsAll = <T>(haystack: T[], needles: T[]): boolean => {
  return !needles.some(needle => !haystack.includes(needle))
}
export const bound = (val: number, min: number, max: number) => {
  const difference = max - min
  let result = val
  while (result < min) {
    result += difference
  }
  while (result >= max) {
    result -= difference
  }
  return result
}

// like a memoizer, but only evaluated once.
export const lazy = <T>(f: () => T): () => T => {
  let result: undefined | T
  return () => (result || (result = f()))
}

export type PartialRecord<A extends string | number | symbol, B> = Partial<Record<A, B>>
export const unreachable = (x: never): never => { throw new Error(x) }
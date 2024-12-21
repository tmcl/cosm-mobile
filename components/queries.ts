import fromAsync from 'array-from-async';
import * as SQLite from 'expo-sqlite'
import type GeoJSON from "geojson";
import * as OsmApi from "@/scripts/clients";
import {SQLiteExecuteAsyncResult} from "expo-sqlite";
import {WayId} from "@/app/Add sign";
import {InteractionManager} from "react-native";

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

    public async doFindAnglePointsForWayPoint(args: {$way_id: number, $node_id: number}): Promise<{ next: GeoJSON.Point, prev: GeoJSON.Point}|undefined> {
        const answer = await this._findAnglePointsForWayPoint!.executeAsync<{nextgeom: string, prevgeom: string}>(args)
		const first = await answer.getFirstAsync()
		const final = first && {next: JSON.parse(first.nextgeom), prev: JSON.parse(first.prevgeom) }
		return final || undefined
    }

	// noinspection JSUnusedGlobalSymbols this shouldn't be used - it exists to create a type error if it is
	public get findTargetNodes(): never { throw "use the do- method" }
	public set findTargetNodes(theQueryWays: SQLite.SQLiteStatement | undefined) {
		this._findTargetNodes?.finalizeAsync()
		this._findTargetNodes = theQueryWays
	}

    public async doFindTargetNodes(args: {$needle: Record<string, string>, $minlon: number, $minlat: number, $maxlon: number, $maxlat: number}) {
		var x = "additional info: there is none"
		try {
		console.log("====================================================hunting nodes")
		const argsModified = {...args, $needle: JSON.stringify(args.$needle), $needleLength: Object.keys(args.$needle).length}
        const r = await this._findTargetNodes!.executeAsync<{ geojson: string, ways: string }>(argsModified)
		const r2 = await r.getAllAsync()
		console.log("i found target nodes", r2, "target nodes gefunden habe ich")
		return r2.map(geo => {
			console.log("//////////////////////I would very much like to parse geo.geojson", geo.geojson)
			x = geo.geojson
				const r: TargetNode = JSON.parse(geo.geojson)
				//const ways: (string | number)[] = JSON.parse(geo.ways)
				console.log(r.properties, r, "something something")
				//r.properties.ways = ways.map(w => w.toString())
				return r
			})
		} catch (e) {
			throw [e, x]
		}
    }

	public set queryWaysWithIntersections(complete: SQLite.SQLiteStatement | undefined) {
		this._queryWaysWithIntersections?.finalizeAsync()
		this._queryWaysWithIntersections = complete
	}

    public async doQueryWaysWithIntersections(args: {$required_ids: WayId[], $minlon: number, $minlat: number, $maxlon: number, $maxlat: number}): Promise<QueryWaysWithIntersections> {
		const allAtOnce = async () => {
			console.log("wanting to query aow")

			const {$required_ids, ...envelope} = args
			const serialArgs = {...envelope, $required_ids: JSON.stringify(args.$required_ids)}
			const waysResult1 = await this._tracker.track("raw query", () => this._queryWaysWithIntersections!.executeAsync<{ length: number|null, geojson: string, centreline: string, other_ways: string, sameroad: string }>(serialArgs), true)
			const waysResult = waysResult1.res
			console.log("//////waysresult raw query", waysResult1.times)
			try {
				const geo_ = await this._tracker.track("fetch query", () => waysResult.getFirstAsync(), true)
				const geo = geo_.res
				console.log("+++ fetch query", geo_.times)

				const result = await this._tracker.track("parse query", async () => {
					const parsedCasings: GeoJSON.Feature<GeoJSON.Polygon, OsmApi.IWay>[] = geo ? JSON.parse(geo.geojson) : []
					const parsedCentrelines: GeoJSON.Feature<GeoJSON.LineString, OsmApi.IWay>[] = geo ? JSON.parse(geo.centreline) : []
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

		console.log("********************times", "all at once", aow.times, ((aow.times.end || 0) - aow.times.ts)/1000 )

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
			this.queryWaysWithIntersections = await db.prepareAsync(require('@/sql/query-ways-with-intersections-all-at-once.sql.json'))
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

type TrackerInfo = {any: any, ts: number, state: "waiting"|"finished"|"failed", end?: number, e?: any, seconds?: number}

class ThingyTracker {
	private _trackees: TrackerInfo[] = []
	private _timeout: number|undefined

	public async track<T, R>(arg: T, f: (arg: T) => Promise<R>): Promise<R> ;
	public async track<T, R>(arg: T, f: (arg: T) => Promise<R>, withTimes: false): Promise<R> ;
	public async track<T, R>(arg: T, f: (arg: T) => Promise<R>, withTimes: true): Promise<{res: R, times: TrackerInfo}> ;
	public async track<T, R>(arg: T, f: (arg: T) => Promise<R>, withTimes = false) {
		const newLength = this._trackees.push({any: arg, ts: new Date().getTime(), state: "waiting"})
		const i = newLength - 1
		this.checktimeout()

		try {
			const r = await f(arg)
			this._trackees[i].state = "finished"
			this._trackees[i].end = new Date().getTime()
			this._trackees[i].seconds = (this._trackees[i].end - this._trackees[i].ts) / 1000
			if(withTimes) {
				return {res: r, times: this._trackees[i]}
			} else {
				return r
			}
		} catch (e) {
			this._trackees[i].state = "failed"
			this._trackees[i].end = new Date().getTime()
			this._trackees[i].seconds = (this._trackees[i].end - this._trackees[i].ts) / 1000
			this._trackees[i].e = e
			throw e
		}
	}

	public checktimeout() {
		if (this._timeout) return
		let interval: number;
		interval = setInterval(() => {
			const now = new Date().getTime()
			let current
			if (this._timeout === interval && (current = this._trackees.filter(f => f.state === "waiting")) && current?.length) {
				console.log("waiting jobs", current.length)
				const old = current.flatMap(f => {
						const duration = f.ts < now - 1_000
					if(duration) {
						return [{...f, seconds: (now - f.ts)/1000}]
					} else
						return []
					}
				)
				console.log("including the following old ones", old)
			} else {
				if(this._timeout == interval) {
					this._timeout = undefined
				}
				clearInterval(interval)
			}
		}, 1_000) as any
		this._timeout = interval
	}
}

export class MainPageQueries {
	private _knownBounds: SQLite.SQLiteStatement | undefined
	private _insertBounds: SQLite.SQLiteStatement | undefined
	private _insertNodes: SQLite.SQLiteStatement | undefined
	private _insertRelatedWays: SQLite.SQLiteStatement | undefined
	private _insertNodesWays: SQLite.SQLiteStatement | undefined
	private _queryNodes: SQLite.SQLiteStatement | undefined
	private _insertWays: SQLite.SQLiteStatement | undefined
	private _queryWays: SQLite.SQLiteStatement | undefined
	private _findNearbyWays: SQLite.SQLiteStatement | undefined
	private _addCasingsToWays: SQLite.SQLiteStatement | undefined

	private _tracker;

	constructor() {
		this._tracker = new ThingyTracker()
	};

	// noinspection JSUnusedGlobalSymbols this shouldn't be used - it exists to create a type error if it is
	public get knownBounds(): never { throw "use the do function" }
	public set knownBounds(theneededareas: SQLite.SQLiteStatement | undefined) {
		this._knownBounds?.finalizeAsync()
		this._knownBounds = theneededareas
	}
	public async doKnownBounds(args: { $minlon: number, $minlat: number, $maxlon: number, $maxlat: number }) {
		const boundsQuer = await this._knownBounds!.executeAsync<{ difference: string }>(args)
		const boundsStr = await boundsQuer.getFirstAsync()
		return JSON.parse(boundsStr!.difference) as GeoJSON.Polygon|null
	}

	// noinspection JSUnusedGlobalSymbols this shouldn't be used - it exists to create a type error if it is
	public get queryNodes(): never { throw "this._queryNodes" }
	public set queryNodes(theQueryNodes: SQLite.SQLiteStatement | undefined) {
		this._queryNodes?.finalizeAsync()
		this._queryNodes = theQueryNodes
	}

	public async *doQueryNodes(args: {$minlon: number, $minlat: number, $maxlon: number, $maxlat: number}) {
		const result = await this._queryNodes!.executeAsync<{ geojson: string }>(args)
		for await (const geojson of result) {
			yield JSON.parse(geojson.geojson) as GeoJSON.Feature<GeoJSON.Point, OsmApi.INode>
		}
	}

	public set queryWays(theQueryWays: SQLite.SQLiteStatement | undefined) {
		this._queryWays?.finalizeAsync()
		this._queryWays = theQueryWays
	}

    public async *doQueryWays(args: {$minlon: number, $minlat: number, $maxlon: number, $maxlat: number}) {
		const result = this._queryWays!.executeSync<{ geojson: string }>(args)
		for await (const geojson of result) {
			yield JSON.parse(geojson.geojson) as GeoJSON.Feature<GeoJSON.Polygon|GeoJSON.LineString, OsmApi.IWay>
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
			console.log("queryResult.changes", queryResult.changes)
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
		if(thequery) {
			const settlers = this.todoAddCasings
			this.todoAddCasings = []
			settlers.forEach(s => s(thequery))
		}

		this._addCasingsToWays = thequery
	}

	private todoAddCasings: ((value: SQLite.SQLiteStatement) => void)[] = []

	public doAddCasingToWays() {
		const currentQuery = this._addCasingsToWays
		if(currentQuery) {
			return currentQuery.executeAsync<never>()
		} else {
			const settler = (resolve: (value: SQLiteExecuteAsyncResult<never>) => void, reject: (reason?: any) => void) =>
				{
					this.todoAddCasings.push(theQuery => theQuery.executeAsync<never>().then(resolve, reject) )
				}
			return new Promise<SQLiteExecuteAsyncResult<never>>( settler )
		}
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
	public get insertNodes():never { throw "this._insertNodes" }
	public set insertNodes(theinsertNodes: SQLite.SQLiteStatement | undefined) {
		this._insertNodes?.finalizeAsync()
		this._insertNodes = theinsertNodes
	}
	public doInsertNodes(param: { $json: string }) {
		return this._tracker.track({"insertNodes": param}, async _ => {
			return this._insertNodes!.executeAsync<never>(param)
		})
	}

	// noinspection JSUnusedGlobalSymbols this shouldn't be used - it exists to create a type error if it is
	public get findNearbyWays():never { throw "this._findNearbyWays" }
	public set findNearbyWays(thequery: SQLite.SQLiteStatement | undefined) {
		this._findNearbyWays?.finalizeAsync()
		this._findNearbyWays = thequery
	}

    public async doFindNearbyWays(args: {"$lat": number, "$lon": number, "$minlon": number, "$minlat": number, "$maxlon": number, "$maxlat": number}) {
		const query = await this._findNearbyWays!.executeAsync<{dist: number, id: string, nearest: string}>(args)
		const queryResult = await query.getAllAsync()
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

    public async doInsertBounds(args: {$json: string, $requestedBounds: [number, number, number, number]}) {
		const [minlon, minlat, maxlon, maxlat] = args.$requestedBounds
		const param = {$json: JSON.stringify({bounds: {minlon, minlat, maxlon, maxlat}})}
		return this._tracker.track({"insert bounds": args}, async _ => {
			return await this._insertBounds!.executeAsync<never>(param)
		})
    }

	async setup(db: SQLite.SQLiteDatabase) {
		this.findNearbyWays = await db.prepareAsync( require('@/sql/find-nearby-ways.sql.json') )
		this.insertBounds = await db.prepareAsync(require('@/sql/insert-bounds.sql.json'))
		this.insertNodes = await db.prepareAsync( require('@/sql/insert-nodes.sql.json') )
		this.insertWays = await db.prepareAsync( require('@/sql/insert-ways.sql.json') )
		this.knownBounds = await db.prepareAsync(require('@/sql/known-bounds.sql.json'))
		this.addCasingToWays = await db.prepareAsync(require('@/sql/add-casing-to-ways.sql.json'))
		this.insertRelatedWays = await db.prepareAsync(require('@/sql/insert-related-ways.sql.json'))

		this.insertNodesWays = await db.prepareAsync( require('@/sql/insert-nodes-ways.sql.json') )
		this.queryNodes = await db.prepareAsync( require('@/sql/query-nodes.sql.json'))
		this.queryWays = await db.prepareAsync( require('@/sql/query-ways.sql.json') )
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
	}
}

export const zip = function <A, B>(aa: A[], bb: B[]): [A, B][] {
    const answer: [A, B][] = []
    for (let i = 0; i < aa.length; i++) {
        if(!bb.hasOwnProperty(i)) { break; }

        answer.push([aa[i], bb[i]])
    }
    return answer
}

export type Maybe<R> = {type: "nothing"}|{type: "just", just: R}
export const mapMaybe = function <T, R>(tt: T[], f: (t: T) => Maybe<R>): R[] {
	const answer: R[] = new Array(tt.length)
	let i: number = 0
	tt.forEach(t => {
		const maybe = f(t)
		if(maybe.type === "just") {
			answer[i++] = maybe.just
		}
	})
	answer.length = i
	return answer
}

export type SqliteBBox = { $minlon: number, $minlat: number, $maxlat: number, $maxlon : number}
export type JsonBBox = { minlon: number, minlat: number, maxlat: number, maxlon : number}
export type GeojsonBBox = [ number, number, number, number] | [ number, number, number, number, number, number]

export type IntersectingWayInfo = {ix: number, node_tags: OsmApi.INode, others: WayId<number>, way_tags: OsmApi.IWay}[]
export function doublePad (bbox: GeojsonBBox): GeojsonBBox
export function doublePad (bbox: JsonBBox): JsonBBox
export function doublePad (bbox: SqliteBBox): SqliteBBox
export function doublePad <T extends GeojsonBBox|JsonBBox|SqliteBBox>
  (args: T): T {
	function doDoublePad({minlon, minlat, maxlon, maxlat}: JsonBBox) {
		const $minlon = minlon - (maxlon - minlon)
		const $maxlon = maxlon + (maxlon - minlon)
		const $minlat = minlat - (maxlat - minlat)
		const $maxlat = maxlat + (maxlat - minlat)
		return {$minlon, $minlat, $maxlon, $maxlat}
	}
	if (args instanceof Array) {
		const [minlon, minlat, maxlon, maxlat] = args
		const {$minlon, $minlat, $maxlon, $maxlat} = doDoublePad({minlon, minlat, maxlon, maxlat})
		return [$minlon, $minlat, $maxlon, $maxlat] as T
	} else if ("$minlon" in args) {
		const {$minlon: minlon, $minlat: minlat, $maxlon: maxlon, $maxlat: maxlat} = args
		return doDoublePad({minlon, minlat, maxlon, maxlat}) as T
	} else {
		const {$minlon: minlon, $minlat: minlat, $maxlon: maxlon, $maxlat: maxlat} = doDoublePad(args)
		return {minlon, minlat, maxlon, maxlat} as T
	}
}


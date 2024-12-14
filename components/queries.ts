import * as SQLite from 'expo-sqlite'
import type GeoJSON from "geojson";
import * as OsmApi from "@/scripts/clients";
import {SQLiteExecuteAsyncResult} from "expo-sqlite";

export class EditPageQueries {
	private _queryWays: SQLite.SQLiteStatement | undefined
	private _findNearbyWays: SQLite.SQLiteStatement | undefined
	private _findTargetNodes: SQLite.SQLiteStatement | undefined
	private _findAnglePointsForWayPoint: SQLite.SQLiteStatement | undefined

	constructor() {};

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

    public doFindTargetNodes(args: {$needle: Record<string, string>, $minlon: number, $minlat: number, $maxlon: number, $maxlat: number}) {
		const argsModified = {...args, $needle: JSON.stringify(args.$needle), $needleLength: Object.keys(args.$needle).length}
        return this._findTargetNodes!.executeAsync<never>(argsModified)
    }

	public set queryWays(theQueryWays: SQLite.SQLiteStatement | undefined) {
		this._queryWays?.finalizeAsync()
		this._queryWays = theQueryWays
	}

    public doQueryWays(args: {$minlon: number, $minlat: number, $maxlon: number, $maxlat: number}) {
        return this._queryWays!.executeAsync<never>(args)
    }

	// noinspection JSUnusedGlobalSymbols this shouldn't be used - it exists to create a type error if it is
	public get findNearbyWays(): never { throw "this._findNearbyWays" }
	public set findNearbyWays(thequery: SQLite.SQLiteStatement | undefined) {
		this._findNearbyWays?.finalizeAsync()
		this._findNearbyWays = thequery
	}

	async setup(db: SQLite.SQLiteDatabase) {
			this.findNearbyWays = await db.prepareAsync( require('@/sql/find-nearby-ways.sql.json') )
			this.queryWays = await db.prepareAsync( require('@/sql/query-ways-with-intersections.sql.json') )
			this.findTargetNodes = await db.prepareAsync( require('@/sql/find-target-elements.sql.json') )
			this.findAnglePointsForWayPoint = await db.prepareAsync( require('@/sql/find-angle-points-for-way-point.sql.json') )
	}

	finalize() {
		 this.findNearbyWays = undefined
		 this.queryWays = undefined
		 this.findTargetNodes = undefined
		 this.findAnglePointsForWayPoint = undefined
	}
}

class ThingyTracker {
	private _trackees: {any: any, ts: number, state: "waiting"|"finished"|"failed", end?: number, e?: any}[] = []
	private _timeout: number|undefined

	public async track<T, R>(arg: T, f: (arg: T) => Promise<R>) {
		const newLength = this._trackees.push({any: arg, ts: new Date().getTime(), state: "waiting"})
		const i = newLength - 1
		this.checktimeout()

		try {
			const r = await f(arg)
			this._trackees[i].state = "finished"
			this._trackees[i].end = new Date().getTime()
			return r
		} catch (e) {
			this._trackees[i].state = "failed"
			this._trackees[i].end = new Date().getTime()
			this._trackees[i].e = e
			throw e
		}
	}

	public checktimeout() {
		if (this._timeout) return
		let interval: number;
		interval = setInterval(() => {
			let current
			if (this._timeout === interval && (current = this._trackees.filter(f => f.state === "waiting")) && current?.length) {
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
		return this._tracker.track({"known bounds": args}, async _ => {
			const boundsQuer = await this._knownBounds!.executeAsync<{ difference: string }>(args)
			const boundsStr = await boundsQuer.getFirstAsync()
			return JSON.parse(boundsStr!.difference) as GeoJSON.Polygon
		})
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
		return {waysInserted: r1, nodeWaysInserted: r2}
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

    public async doFindNearbyWays(args: {"$lat": number, "$lon": number}) {
		return this._tracker.track({"find nearby ways": args}, async _ => {
				const query = await this._findNearbyWays!.executeAsync<{dist: number, id: string, nearest: string}>(args)
				return await query.getAllAsync()
		})
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
		this.queryWays = undefined
	}
}

export const debug = function <T>(msg:string, t: T): T { console.log(msg, t); return t }
export const zip = function <A, B>(aa: A[], bb: B[]): [A, B][] {
    const answer: [A, B][] = []
    for (let i = 0; i < aa.length; i++) {
        if(!bb.hasOwnProperty(i)) { break; }

        answer.push([aa[i], bb[i]])
    }
    return answer
}

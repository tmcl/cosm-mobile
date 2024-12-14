import * as SQLite from 'expo-sqlite'
import type GeoJSON from "geojson";
import * as OsmApi from "@/scripts/clients";
import {SQLiteExecuteAsyncResult} from "expo-sqlite";

const consoleLog: typeof console.log = () => {}

export class EditPageQueries {
	private _queryWays: SQLite.SQLiteStatement | undefined
	private _findNearbyWays: SQLite.SQLiteStatement | undefined
	private _findTargetNodes: SQLite.SQLiteStatement | undefined
	private _findAnglePointsForWayPoint: SQLite.SQLiteStatement | undefined

	constructor() {};

	// noinspection JSUnusedGlobalSymbols this shouldn't be used - it exists to create a type error if it is
	public get findAnglePointsForWayPoint(): never { throw "use the do- method" }
	public set findAnglePointsForWayPoint(theQueryWays: SQLite.SQLiteStatement | undefined) {
        consoleLog("i wanted to set the find angle points", theQueryWays)
		this._findAnglePointsForWayPoint?.finalizeAsync()
		this._findAnglePointsForWayPoint = theQueryWays
	}

    public async doFindAnglePointsForWayPoint(args: {$way_id: number, $node_id: number}): Promise<{ next: GeoJSON.Point, prev: GeoJSON.Point}|undefined> {
        if (!this._findAnglePointsForWayPoint) { consoleLog("i wanted to query the target nodes", args, "but i have nothing to do it with") }
        const answer = await this._findAnglePointsForWayPoint!.executeAsync<{nextgeom: string, prevgeom: string}>(args)
		consoleLog("i got an answer", answer)
		const first = await answer.getFirstAsync()
		consoleLog("i got a first", first)
		const final = first && {next: JSON.parse(first.nextgeom), prev: JSON.parse(first.prevgeom) }
		consoleLog("and finally", final)
		return final || undefined
    }

	// noinspection JSUnusedGlobalSymbols this shouldn't be used - it exists to create a type error if it is
	public get findTargetNodes(): never { throw "use the do- method" }
	public set findTargetNodes(theQueryWays: SQLite.SQLiteStatement | undefined) {
        consoleLog("i wanted to set the find target nodes", theQueryWays)
		this._findTargetNodes?.finalizeAsync()
		this._findTargetNodes = theQueryWays
	}

    public doFindTargetNodes(args: {$needle: Record<string, string>, $minlon: number, $minlat: number, $maxlon: number, $maxlat: number}) {
        if (!this._findTargetNodes) { consoleLog("i wanted to query the target nodes", args, "but i have nothing to do it with") }
		const argsModified = {...args, $needle: JSON.stringify(args.$needle), $needleLength: Object.keys(args.$needle).length}
        return this._findTargetNodes!.executeAsync<never>(argsModified)
    }

	public set queryWays(theQueryWays: SQLite.SQLiteStatement | undefined) {
        consoleLog("i wanted to set the query ways", theQueryWays)
		this._queryWays?.finalizeAsync()
		this._queryWays = theQueryWays
	}

    public doQueryWays(args: {$minlon: number, $minlat: number, $maxlon: number, $maxlat: number}) {
        if (!this._queryWays) { consoleLog("i wanted to query the ways", args, "but i have nothing to do it with") }
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
		consoleLog("**t*starting", arg)
		const newLength = this._trackees.push({any: arg, ts: new Date().getTime(), state: "waiting"})
		const i = newLength - 1
		this.checktimeout()

		try {
			const r = await f(arg)
		consoleLog("**t**finishing", arg)
			this._trackees[i].state = "finished"
			this._trackees[i].end = new Date().getTime()
			return r
		} catch (e) {
			consoleLog("**t***awaiter failed", arg, i, e)
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
			const now = new Date().getTime()
			let current
				consoleLog("failed jobs", this._trackees.filter(f => f.state == "failed"))
			if (this._timeout === interval && (current = this._trackees.filter(f => f.state === "waiting")) && current?.length) {
				consoleLog("waiting jobs", current.filter(s => s.state == "waiting").length)
				const old = current.filter(f => f.state == "waiting" && f.ts < now - 1_000)
				consoleLog("including the following old ones", old.map(o => ({...o, diff: (now - o.ts)/1000})))
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
		consoleLog("what are the known bounds", args)
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

	private voom = 0

    public async *doQueryWays(args: {$minlon: number, $minlat: number, $maxlon: number, $maxlat: number}) {
		const voom = this.voom++
		let vool = 0
		const result = this._queryWays!.executeSync<{ geojson: string }>(args)
		for await (const geojson of result) {
			const result = JSON.parse(geojson.geojson) as GeoJSON.Feature<GeoJSON.Polygon|GeoJSON.LineString, OsmApi.IWay>
			if(result.id == 992972544) {
				consoleLog(result, result.id, voom, vool++)
			}
			yield result
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
		consoleLog("query add casing to ways", thequery, this._addCasingsToWays)
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
			try {
				const query = await this._findNearbyWays!.executeAsync<{dist: number, id: string, nearest: string}>(args)
				return await query.getAllAsync()
			} catch (e) {
				consoleLog("some kind of error fnbw", args, e)
				throw e
			}
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
			try {
				return await this._insertBounds!.executeAsync<never>(param)
			} catch (e) {
				consoleLog("some kind of error ib", args, e)
				throw e
			}
		})
    }

	async setup(db: SQLite.SQLiteDatabase) {
			consoleLog(1)
		let x = 0;
			try {
				x++
			this.findNearbyWays = await db.prepareAsync( require('@/sql/find-nearby-ways.sql.json') )
				x++
			this.insertBounds = await db.prepareAsync(require('@/sql/insert-bounds.sql.json'))
				x++
			this.insertNodes = await db.prepareAsync( require('@/sql/insert-nodes.sql.json') )
				x++
			this.insertWays = await db.prepareAsync( require('@/sql/insert-ways.sql.json') )
				x++
			this.knownBounds = await db.prepareAsync(require('@/sql/known-bounds.sql.json'))
				x++
			this.addCasingToWays = await db.prepareAsync(require('@/sql/add-casing-to-ways.sql.json'))
				x++

			consoleLog("inw")
			this.insertNodesWays = await db.prepareAsync( require('@/sql/insert-nodes-ways.sql.json') )
				x++
			consoleLog("qn")
			this.queryNodes = await db.prepareAsync( require('@/sql/query-nodes.sql.json'))
				x++
			consoleLog("qw")
			this.queryWays = await db.prepareAsync( require('@/sql/query-ways.sql.json') )
				x++
			} catch (e) {
				consoleLog("************/////////////////////////////*******************failed setting up", x, e, this)
			}
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

export class MemoryWorkerQueue {
	private others: (() => Promise<any>)[] = []
	private current: Promise<any>|null = null

	public accept(f: () => Promise<any>) {
		this.others.push(async () => { try {await f()} catch (e) {consoleLog("not everything working", e); throw e }})
		this.act()
	}

	private act() {
		if (this.current) { consoleLog("already working"); return }
		const one = this.others.pop()
		if(!one) { consoleLog("none left"); return }
		let clear = () => {
			this.current = null
			this.act()
		}
		this.current = one().then(() => clear(), (e) => {clear(); consoleLog("there was an error", e); throw e })
		consoleLog("taking one, hereafter remain ", this.others.length)
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

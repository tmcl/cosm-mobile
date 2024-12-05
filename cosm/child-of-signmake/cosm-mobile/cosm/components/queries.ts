
import * as SQLite from 'expo-sqlite'

export class EditPageQueries {
	private _queryWays: SQLite.SQLiteStatement | undefined
	private _findNearbyWays: SQLite.SQLiteStatement | undefined
	private _findTargetNodes: SQLite.SQLiteStatement | undefined
	private _findAnglePointsForWayPoint: SQLite.SQLiteStatement | undefined

	constructor() {};

	public get findAnglePointsForWayPoint(): never { throw "use the do- method" }
	public set findAnglePointsForWayPoint(theQueryWays: SQLite.SQLiteStatement | undefined) {
        console.log("i wanted to set the find angle points", theQueryWays)
		this._findAnglePointsForWayPoint?.finalizeAsync()
		this._findAnglePointsForWayPoint = theQueryWays
	}

    public async doFindAnglePointsForWayPoint(args: {$way_id: number, $node_id: number}): Promise<{ next: GeoJSON.Point, prev: GeoJSON.Point}|undefined> {
        if (!this._findAnglePointsForWayPoint) { console.log("i wanted to query the target nodes", args, "but i have nothing to do it with") }
        const answer = await this._findAnglePointsForWayPoint!.executeAsync(args)
		console.log("i got an answer", answer)
		const first = await answer?.getFirstAsync() as {nextgeom: string, prevgeom: string}|undefined
		console.log("i got a first", first)
		const final = first && {next: JSON.parse(first.nextgeom), prev: JSON.parse(first.prevgeom) }
		console.log("and finally", final)
		return final
    }

	public get findTargetNodes(): never { throw "use the do- method" }
	public set findTargetNodes(theQueryWays: SQLite.SQLiteStatement | undefined) {
        console.log("i wanted to set the find target nodes", theQueryWays)
		this._findTargetNodes?.finalizeAsync()
		this._findTargetNodes = theQueryWays
	}

    public doFindTargetNodes(args: {$needle: Record<string, string>, $minlon: number, $minlat: number, $maxlon: number, $maxlat: number}) {
        if (!this._findTargetNodes) { console.log("i wanted to query the target nodes", args, "but i have nothing to do it with") }
		const argsModified = {...args, $needle: JSON.stringify(args.$needle), $needleLength: Object.keys(args.$needle).length}
        return this._findTargetNodes!.executeAsync(argsModified)
    }

	public set queryWays(theQueryWays: SQLite.SQLiteStatement | undefined) {
        console.log("i wanted to set the query ways", theQueryWays)
		this._queryWays?.finalizeAsync()
		this._queryWays = theQueryWays
	}

    public doQueryWays(args: {$minlon: number, $minlat: number, $maxlon: number, $maxlat: number}) {
        if (!this._queryWays) { console.log("i wanted to query the ways", args, "but i have nothing to do it with") }
        return this._queryWays!.executeAsync(args)
    }

	public get findNearbyWays() { return this._findNearbyWays }
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
	private _trackees: {any: any, ts: number, state: "waiting"|"finished"|"failed", end?: number}[] = []
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
			console.log("awaiter failed", arg, i, e)
			this._trackees[i].state = "failed"
			this._trackees[i].end = new Date().getTime()
			throw e
		}
	}

	public checktimeout() {
		if (this._timeout) return
		let interval: number;
		interval = setInterval(() => {
			const now = new Date().getTime()
			let current
			if (this._timeout === interval && (current = this._trackees.filter(f => f.state == "waiting")) && current?.length) {
				console.log("waiting jobs", current.length)
				const old = current.filter(f => f.ts < now - 1_000)
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
	private _insertNodesWays: SQLite.SQLiteStatement | undefined
	private _queryNodes: SQLite.SQLiteStatement | undefined
	private _insertWays: SQLite.SQLiteStatement | undefined
	private _queryWays: SQLite.SQLiteStatement | undefined
	private _findNearbyWays: SQLite.SQLiteStatement | undefined

	private _tracker;

	constructor() {
		this._tracker = new ThingyTracker()
	};

	public get knownBounds(): never { throw "use the do function" }
	public set knownBounds(theneededareas: SQLite.SQLiteStatement | undefined) {
		this._knownBounds?.finalizeAsync()
		this._knownBounds = theneededareas
	}
	public async doKnownBounds(args: { $minlon: number, $minlat: number, $maxlon: number, $maxlat: number }) {
		return this._tracker.track({"known bounds": args}, async _ => {
			try {
				return await this._knownBounds!.executeAsync(args)
			} catch (e) {
				console.log("some kind of error, kb", args, e) 
				throw e
			}
		})
	}

	public get queryNodes(): never { throw "this._queryNodes" }
	public set queryNodes(theQueryNodes: SQLite.SQLiteStatement | undefined) {
		this._queryNodes?.finalizeAsync()
		this._queryNodes = theQueryNodes
	}

	public async doQueryNodes() {
		return this._tracker.track({queryNodes: undefined}, async _ => {
			try {
				return await this._queryNodes!.executeAsync()
			} catch (e) {
				console.log("some kind of error, qn", e) 
				throw e
			}
		})
	}

	public set queryWays(theQueryWays: SQLite.SQLiteStatement | undefined) {
		this._queryWays?.finalizeAsync()
		this._queryWays = theQueryWays
	}

    public async doQueryWays(args: {$minlon: number, $minlat: number, $maxlon: number, $maxlat: number}) {
		return this._tracker.track({"queryways": args}, async _ => {
			try {
				return await this._queryWays!.executeAsync(args)
			} catch (e) {
				console.log("some kind of error qw", args, e) 
				throw e
			}
		})
    }

	public get insertNodesWays(): never { throw "use the do function" }
	public set insertNodesWays(theinsertWays: SQLite.SQLiteStatement | undefined) {
		this._insertNodesWays?.finalizeAsync()
		this._insertNodesWays = theinsertWays
	}

	public get insertWays(): never { throw "use the do function" }
	public set insertWays(theinsertWays: SQLite.SQLiteStatement | undefined) {
		this._insertWays?.finalizeAsync()
		this._insertWays = theinsertWays
	}
	public doInsertWays(param: { $json: string }) {
		const r1 = this._tracker.track("insert ways", async _ => this._insertWays!.executeAsync(param))
		const r2 = this._tracker.track("insert nodes ways", async _ => this._insertNodesWays!.executeAsync(param))
		return {waysInserted: r1, nodeWaysInserted: r2}
	}

	public get insertNodes():never { throw "this._insertNodes" }
	public set insertNodes(theinsertNodes: SQLite.SQLiteStatement | undefined) {
		this._insertNodes?.finalizeAsync()
		this._insertNodes = theinsertNodes
	}
	public doInsertNodes(param: { $json: string }) {
		return this._tracker.track({"insertNodes": param}, async _ => {
			return this._insertNodes!.executeAsync(param)
		})
	}

	public get findNearbyWays():never { throw "this._findNearbyWays" }
	public set findNearbyWays(thequery: SQLite.SQLiteStatement | undefined) {
		this._findNearbyWays?.finalizeAsync()
		this._findNearbyWays = thequery
	}

    public async doFindNearbyWays(args: {"$lat": number, "$lon": number}) {
		return this._tracker.track({"find nearby ways": args}, async _ => {
			try {
				return await this._findNearbyWays!.executeAsync(args)
			} catch (e) {
				console.log("some kind of error fnbw", args, e) 
				throw e
			}
		})
    }

	public get insertBounds(): never { throw "this._insertBounds" }
	public set insertBounds(theinsertBounds: SQLite.SQLiteStatement | undefined) {
		this._insertBounds?.finalizeAsync()
		this._insertBounds = theinsertBounds
	}

    public async doInsertBounds(args: {$json: string}) {
		return this._tracker.track({"insert bounds": args}, async _ => {
			try {
				return await this._insertBounds!.executeAsync(args)
			} catch (e) {
				console.log("some kind of error ib", args, e) 
				throw e
			}
		})
    }

	async setup(db: SQLite.SQLiteDatabase) {
			console.log(1)
			try {
			this.findNearbyWays = await db.prepareAsync( require('@/sql/find-nearby-ways.sql.json') )
			this.insertBounds = await db.prepareAsync(require('@/sql/insert-bounds.sql.json'))
			this.insertNodes = await db.prepareAsync( require('@/sql/insert-nodes.sql.json') )
			this.insertWays = await db.prepareAsync( require('@/sql/insert-ways.sql.json') )
			this.knownBounds = await db.prepareAsync(require('@/sql/known-bounds.sql.json'))

			console.log("inw")
			this.insertNodesWays = await db.prepareAsync( require('@/sql/insert-nodes-ways.sql.json') )
			console.log("qn")
			this.queryNodes = await db.prepareAsync( require('@/sql/query-nodes.sql.json'))
			console.log("qw")
			this.queryWays = await db.prepareAsync( require('@/sql/query-ways.sql.json') )
			} catch (e) {
				console.log("failed setting up", e, this)

			this.knownBounds = undefined
			this.insertBounds = undefined
			this.findNearbyWays = undefined
			this.insertNodes = undefined
			this.insertWays = undefined
			this.insertNodesWays = undefined
			this.queryNodes = undefined
			this.queryWays = undefined
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
		 this.queryWays = undefined
	}
}

export class JustOnce {
	private others: (() => Promise<any>)[] = []
	private current: Promise<any>|null = null
	private timeout: number = 0

	public take(f: () => Promise<any>) {
		this.others.push(f)
		this.act()
		const timeout = ++this.timeout
		console.log("setting", timeout, this.timeout)
		setTimeout(() => {
			console.log("checking", timeout, this.timeout)
			if (timeout == this.timeout) {
				this.actAlt()
			}
		}, 500)
	}

	private actAlt() {
		const one = this.others.pop()
		if(!one) { console.log("alt none left"); return }
		one()
		console.log("alt taking one while there are others left", this.others.length)
	}

	private act() {
		if (this.current) { console.log("already working"); return }
		const one = this.others.pop()
		if(!one) { console.log("none left"); return }
		let clear = () => {
			this.current = null
			this.act()
		}
		this.current = one().then(clear, clear)
		console.log("taking one, hereafter remain ", this.others.length)
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

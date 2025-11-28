import {DOMImplementation, XMLSerializer} from "@xmldom/xmldom";
import {InteractionManager, ScrollView, View} from "react-native"
import {Text, ListItem, SpeedDial} from "@rneui/themed"
import {useQuery, useQueryClient} from "@tanstack/react-query"
import {initialQueryState, useReviewPageQueries} from "@/components/queries";
import {router} from "expo-router";
import {useCallback, useState} from "react"
import {JsonBBox, SavedChangeSet, WayId} from "@/components/types";
import type GeoJSON from "geojson";
import {modalNotes, StopSignChange} from "@/components/diff-info";
import useOsmData, {WaysInfo} from "@/components/useOsmData";
import useOsmPopulator from "@/components/useOsmPopulator";
import * as OsmDiff from "@/scripts/ts-xml-object-parser/osm-diff";

const floorHundredths = (a: number): number => Math.floor(a*100)/100
const ceilHundredths = (a: number): number => Math.ceil(a*100)/100

const boundsFromChange = (change: StopSignChange): JsonBBox|undefined => {
  const bounds:{minlon: number|undefined, minlat: number|undefined, maxlon: number|undefined, maxlat: number|undefined} =
      {minlon: undefined, minlat: undefined, maxlon: undefined, maxlat: undefined}
  const assignMin = (val: number, cur: number|undefined): number => {
    return cur === undefined ? val : Math.min(val, cur)
  }
  const assignMax = (val: number, cur: number|undefined): number => {
    return cur === undefined ? val : Math.max(val, cur)
  }

  const assignPoint = (p: GeoJSON.Point): void => {
    bounds.minlon = assignMin(floorHundredths(p.coordinates[0]), bounds.minlon)
    bounds.minlat = assignMin(floorHundredths(p.coordinates[1]), bounds.minlat)
    bounds.maxlon = assignMax(ceilHundredths(p.coordinates[0]), bounds.maxlon)
    bounds.maxlat = assignMax(ceilHundredths(p.coordinates[1]), bounds.maxlat)
  }
  if(change.highwayLocation) {
    switch (change.highwayLocation.type) {
      case "new":
        assignPoint(change.highwayLocation.point.geometry)
        break;
      case "Feature":
        assignPoint(change.highwayLocation.geometry)
        break;
    }
  }
  if(change.tappedLocation) {
    switch (change.tappedLocation.type) {
      case "new":
        assignPoint(change.tappedLocation.point)
        break;
      case "Feature":
        assignPoint(change.tappedLocation.geometry)
    }
  }
  // all sorts of weird copying to satisfy typescript
  const minlat = bounds.minlat
  const minlon = bounds.minlon
  const maxlat = bounds.maxlat
  const maxlon = bounds.maxlon
  return minlat === undefined || minlon === undefined || maxlat === undefined || maxlon === undefined ? undefined : {minlat, minlon, maxlon, maxlat}
}

function SubmitStop(params: {change: StopSignChange}) {
  const bounds = boundsFromChange(params.change)
  useOsmPopulator(bounds, true, () => {}, InteractionManager.runAfterInteractions)
  const [intersections, setIntersections] = useState({})
 const [sameRoads, setSameRoads] = useState({})
  const [queryWays, withNewWays] = useState(initialQueryState<unknown, WaysInfo>())
  const isWaySelected= useCallback((w: WayId) => params.change.selectedWays.includes(w), [params.change.selectedWays])
  console.log('sumitstop params', params)
  useOsmData({loadingBounds: bounds, intersections, setIntersections, isWaySelected, withNewWays, interestingWays: params.change.selectedWays, sameRoads, setSameRoads})
  if (!queryWays.data || !queryWays.data.centrelines || !queryWays.data.centrelines.features) return <Text>Loading...</Text>
  const q= queryWays.data?.centrelines?.features
  console.log('the q', q && JSON.stringify(q).substring(0, 15))
  const activeWays = q
  .filter(f => f.id && params.change.selectedWays.includes(f.id.toString())) || []
  const notes = modalNotes(intersections, params.change, activeWays)
  const domImpl = new DOMImplementation();
  const doc = domImpl.createDocument(null, 'osmChange');
  OsmDiff.buildOsmChangeXML(doc, notes.osmChange);
  const xml = new XMLSerializer().serializeToString(doc);
  return <Text>
    {xml}
    {JSON.stringify(notes.osmChange)}
  </Text>
}


export default function Review() {
   const queries = useReviewPageQueries()
   const queryClient = useQueryClient()
   const [checked, setChecked] = useState<{[ix: number]: boolean}>({})
  const toggle = (ix: number) => setChecked({...checked, [ix]: !checked[ix]})
   const qReviewable = useQuery({
      queryKey: ["spatialite", "needed for loading"],
      queryFn: () => queries.current.queryChanges()
   })
  const [speedDialOpen, setSpeedDialOpen] = useState (false)

  const [submitting , setSubmitting] = useState<Record<number, SavedChangeSet>>({})
  const addSubmitting = (scs: SavedChangeSet) => submitting[scs.id] || setSubmitting({...submitting, [scs.id]: scs})

  const onSubmit= async () => {
    const checkedIds = Object.entries(checked)
    .filter(([_id, isChecked]) => isChecked)
    .map(([id]) => Number(id));
    if(checkedIds.length === 0) return;

    const checkedId = checkedIds[0]
    // const changesetId = +( await putApi06ChangesetCreateText({changeset: {created_by: user_agent}}) )

    const change = await queries.current.selectUserChange(checkedId)
    console.log("i want to somehow save this change", change)
    change && addSubmitting(change)

    //const diff: OsmChange = {
    //  version: "0.6",
    //  generator: user_agent,
    //  create, modify, delete: delete_
    //}
  }

  const onDelete = async () => {
    const checkedIds = Object.entries(checked)
      .filter(([_id, isChecked]) => isChecked)
      .map(([id]) => Number(id));
    console.log("i will delete", checkedIds)
    try {
      const v = await queries.current.deleteChanges({ids: checkedIds})
      console.log("i deleted", v)
      Promise.all([
        queryClient.invalidateQueries({queryKey: ["spatialite", "needed for loading"]}),
        queryClient.invalidateQueries({queryKey: ["needed for loading"]})])
      setSpeedDialOpen(false)
    } catch (e) {
      console.log("i unsuccessfully deleted", e)
    }
  }

   console.log(qReviewable.error, qReviewable.status, qReviewable.fetchStatus)

   const result = qReviewable.isSuccess
      ? (qReviewable.data).map(change => {
         const date = new Date(0)
         date.setUTCSeconds(change.modified_date || change.created_date)
         const formattedDate = date.toLocaleDateString()
         const params = {id: JSON.stringify(change.id)}
         const href = `/(tabs)?${new URLSearchParams(params).toString()}` as const
         const onPress = () => router.navigate(href)
         console.log(`each change.id ${change.id} ${JSON.stringify(change)}`)
         return <ListItem onPress={onPress} key={change.id}>
           <ListItem.Content>
           <ListItem.Title>{change.commentary1 || (change.type === "addStopSign" ? "*Add Stop Sign" : change.type)}</ListItem.Title>
           <ListItem.Subtitle>{change.commentary2 ? `${change.commentary2} at ${formattedDate}` : formattedDate}</ListItem.Subtitle>
           {submitting[change.id] && change.type==="addStopSign" && <SubmitStop change={JSON.parse(change.state_extract)} />}
           </ListItem.Content>
           <ListItem.CheckBox
               key={1}
               checked={checked[change.id]}
               onPress={() => toggle(change.id)}
           />
         </ListItem>
      })
      : <Text key={"nothing"}>Loading. Or an Error.</Text>


   return <View style={{flex: 1}}>
     <ScrollView>{result}</ScrollView>
     <SpeedDial
         isOpen={speedDialOpen}
         onOpen={() => setSpeedDialOpen(true)}
         onClose={() => setSpeedDialOpen(false)}
     >
       <SpeedDial.Action
           icon={{ name: 'add', color: '#fff' }}
           title="Submit"
           onPress={onSubmit}
       />
       <SpeedDial.Action
      icon={{ name: 'delete', color: '#fff' }}
      title="Delete"
      onPress={onDelete}
    />
     </SpeedDial>
   </View>
}

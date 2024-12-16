import React, {Reducer, useEffect, useReducer, useRef, useState} from 'react'
import * as ReactQuery from '@tanstack/react-query'
import * as Svg from 'react-native-svg'
import type * as OsmApi from "@/scripts/clients";
import type {RegionPayload} from '@maplibre/maplibre-react-native/src/components/MapView';
import MapLibreGL from '@maplibre/maplibre-react-native';
import {StyleSheet, Text, View, ViewProps} from "react-native";
import {useLocalSearchParams} from "expo-router";
import * as SQLite from 'expo-sqlite'
import {EditPageQueries, IntersectingWayInfo, mapMaybe, Maybe, TargetNode} from '@/components/queries';
import {detailedMapStyle} from '@/constants/DetailedMapStyle'
import {OnPressEvent} from '@maplibre/maplibre-react-native/src/types/OnPressEvent';
import * as turf from '@turf/turf'
import * as RNE from '@rneui/themed'

type NumberStr = `${number}`
type Derived =`derived-${NumberStr}`
type NodeId = NumberStr | Derived

const digit = /^[0-9]+$/

const isNodeId = (nodeId: string|number|undefined): nodeId is NodeId => {
  return !!nodeId && typeof nodeId === "string" && (isNumber(nodeId) || isDerived(nodeId))
}

const isDerived = (nodeId: string): nodeId is Derived => {
  const derivedLength = "derived-".length
  const prefix = nodeId.substring(0, derivedLength)
  const interesting = prefix === "derived-" && nodeId.substring(derivedLength)
  return !!interesting && digit.test(interesting)
}

const isNumber = (nodeId: string): nodeId is NumberStr => {
  return digit.test(nodeId)
}

const VStack = ({children, ...props}: React.PropsWithChildren<ViewProps>) => 
  <View {...props} style={Object.assign(props.style || {}, {flexDirection: 'column'})}>{children}</View>

const HStack = ({children, ...props}: React.PropsWithChildren<ViewProps>) => 
  <View {...props} style={Object.assign(props.style || {}, {width: "100%", flexDirection: 'row'})}>{children}</View>

type State = DirectionState & {
  selectedWays: WayId[]
  selectedNodes: NodeId[]
  nearestPoints: Record<WayId, NearestPoint>
}
type DirectionState = {
  direction: Direction|undefined,
  directions: Partial<Record<DirectionOrigin, Direction>>
}
type SelectWay = { 
	action: "select ways",
 	wayId: WayId[],
 	waysCentreline: GeoJSON.Feature<GeoJSON.LineString>[] | undefined,
	signLocation: GeoJSON.Position,
  targetPoints: TargetNode[] | undefined
}
type DeselectWay = { action: "deselect ways", wayId: WayId[] }
type DeselectNodes = { action: "deselect nodes", pointId: NodeId[] }
type SelectNodes = { action: "select nodes", pointId: NodeId[] }
type UpdateNearestPoint = { action: "update nearest point", nearestPoint: NearestPoint }
type LearnDirection = { type: DirectionOrigin, direction: Direction }
type ForgetDirection = { type: DirectionOrigin, direction?: undefined }
type DirectionAction = LearnDirection | ForgetDirection
type Action = (DirectionAction & {action: "set direction"}) | SelectWay | DeselectWay | SelectNodes | DeselectNodes | UpdateNearestPoint
const correspondingWayId = (nodeId: Derived): WayId => {
  return nodeId.substring("derived-".length)
}
const nodeIsOnWay = (nodeId: NodeId, wayId: WayId, targetNodes: TargetNode[]|undefined): boolean => {
  if (isDerived(nodeId)) {
    return wayId === correspondingWayId(nodeId)
  } else {
    const t = targetNodes?.find(f => f.id === nodeId)
    return !!t && t.properties.ways.includes(wayId)
  }
}
const wayHasSelectedNode = (wayId: WayId, state: State, targetNodes: TargetNode[]|undefined): boolean => {
  return state.selectedNodes.some(nodeId => nodeIsOnWay(nodeId, wayId, targetNodes))
}
const reducer = (state: State, action: Action): State => {
  switch (action.action) {
    case "set direction" : return {...state, ...directionReducer(state, action)}
    case "select ways": 
			const newNearestPoints = {... state.nearestPoints}
		  let madeNewPoint = false

        const createNewNearestPoint = (wayId: WayId) => {
          if(newNearestPoints[wayId]) return
          const way = action.waysCentreline?.find(w => w.id === wayId)
          if(!way) return
          const closestPoint = turf.nearestPointOnLine(way, action.signLocation)
          closestPoint.id = `derived-${wayId}`
          newNearestPoints[wayId] = {...closestPoint, properties: {...closestPoint.properties, originalWay:wayId}}
          madeNewPoint = true
        }

        const newSelections: NodeId[] = []
        const selectTargetPoints = (way: WayId) => {
              if(!wayHasSelectedNode(way, state, action.targetPoints)) {
                const tp = action.targetPoints?.find(f => f.properties.ways.includes(way))
                if (tp && typeof tp.id === "string" && isNumber(tp.id)) newSelections.push(tp.id)
              }
        }

			action.wayId.forEach(f => { createNewNearestPoint(f); selectTargetPoints(f) })

			return {...state, ...(newSelections.length ? {selectedNodes: [...state.selectedNodes, ...newSelections]} : {}), ...(madeNewPoint ? { nearestPoints: newNearestPoints } : {}), selectedWays: [...state.selectedWays, ...action.wayId]}
    case "update nearest point": return {...state, nearestPoints: {...state.nearestPoints, [action.nearestPoint.properties.originalWay]: action.nearestPoint}}
    case "deselect ways": return {...state, selectedWays: state.selectedWays.filter(f => !action.wayId.includes(f))}
    case "deselect nodes": return {...state, selectedNodes: state.selectedNodes.filter(f => !action.pointId.some(g => (f === g)))}
    case "select nodes": return {...state, selectedNodes: state.selectedNodes.concat(action.pointId)}
  }
}
const directionReducer = (state: DirectionState, action: DirectionAction): DirectionState => {
  const newDirections = {... state.directions}

  if(action.direction) {
    newDirections[action.type] = action.direction
  } else {
    delete newDirections[action.type]
  }

  const newDirection = newDirections.specified_tag || newDirections.specified_user || newDirections.inferred || "forward"

  return {directions: newDirections, direction: newDirection}
}
const ensureDirection = (directionStr: string|undefined): Direction|undefined => {
  switch (directionStr) {
    case "forward":
    case "backward":
      return directionStr
    default:
      return undefined
  }
}

type Direction = "forward" | "backward"
type DirectionOrigin =  "inferred" | "specified_tag" | "specified_user"

type FeaturePayload = GeoJSON.Feature<
GeoJSON.Point,
{
  screenPointX: number;
  screenPointY: number;
}>


type TurfNearestPoint = GeoJSON.Feature<GeoJSON.Point, {
  dist: number;
  index: number;
  location: number;
}>
type NearestPoint = GeoJSON.Feature<GeoJSON.Point, {
    dist: number;
    index: number;
    location: number;
    originalWay: WayId
}>

const bound = (val: number, min: number, max: number) => {
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

const roadcasingsLayerStyle = (activeWayIds: string[]): MapLibreGL.FillLayerStyle => ({
  fillColor: ["case", ["in", ["id"], ["literal", activeWayIds]], "purple", "red"],
  fillOpacity: 0.24,
})
const nearestPointsCircleLayerStyle: (nodeIds: NodeId[]) => MapLibreGL.CircleLayerStyle = (nodeIds) => ({
    circleColor: ["case", ["in", ["id"], ["literal", nodeIds.filter(m => isDerived(m))]], "green", "gray"],
    circleOpacity: 0.84,
    circleStrokeWidth: 2,
    circleStrokeColor: "white",
    circleRadius: 7,
    circlePitchAlignment: "map"
})

const selectableCircleLayerStyle: (nodeIds: NodeId[]) => MapLibreGL.CircleLayerStyle = (nodeIds) => ({
  circleColor: ["case", ["in", ["id"], ["literal", nodeIds.filter(m => isNumber(m))]], "green", "gray"],
    circleOpacity: 0.84,
    circleStrokeWidth: 2,
    circleStrokeColor: "white",
    circleRadius: 5,
    circlePitchAlignment: "map"
})

const signTypeIcon: Record<SignType, RNE.IconProps> = {
  "maxspeed,city_limit maxspeed=?? name=?! city_limit=begin": {name: "rectangle", color: "green"},
  "maxspeed maxspeed=?!": {name: "circle", type: "octicon", color: "red"},
  "stop": {name: "octagon", color: "red", type:"material-community"},
  "give_way": {name: "triangle-outline", style: {transform: [{rotate: '180deg'}]}, color: "red", type:"material-community"},
  "give_way,roundabout": {name: "arrows-spin", type:"font-awesome-6"},
  "stop_ahead distance=??": {name: "octagon", color: "black", type:"material-community"},
  "yield_ahead distance=??": {name: "triangle-outline", style: {transform: [{rotate: '180deg'}]}, color: "black", type:"material-community"},
  "signal_ahead distance=??": {name: "traffic-light", type:"font-awesome-5"},
  "hazard hazard=?!": {name: "diamond", color:"orange", type:"font-awesome-6"}
}

const signTypes = {
  "maxspeed,city_limit maxspeed=?? name=?! city_limit=begin": "City Limit",
  "maxspeed maxspeed=?!": "Speed Limit",
  "stop": "Stop",
  "give_way": "Give Way",
  "give_way,roundabout": "Roundabout",
  "stop_ahead distance=??": "Stop Ahead",
  "yield_ahead distance=??": "Give Way Ahead",
  "signal_ahead distance=??": "Traffic Lights Ahead",
  "hazard hazard=?!": "Warning"
}


export type SignType = keyof typeof signTypes

const isValidValue = (signType: string): signType is SignType => {
  return !!(signTypes as any)[signType]
}

const hazardTypes = {
  "animal_crossing hazard:animal=??": "Animal Crossing",
  "bump": "Speed Hump",
  "children": "Children",
  "curve curve:direction=??": "Curve",
  "curve curve=hairpin curve:direction=??": "Hairpin curve",
  "curve curve=loop curve:direction=??": "Loop",
  "curves curves=serpentine curve:direction=??": "Serpentive/Double Curve",
  "curves curves=extended curve:direction=??": "Extended curves/Windy road",
  "cyclists": "Cyclists",
  "crossroad priority=with_us": "Crossroads",
  "sideroad priority=with_us sideroad:direction=?": "Side road",
  "crossroad priority=with_us staggered:direction=?": "Staggered crossroad road",
}

type HazardType = keyof typeof hazardTypes

const isValidHazardType = (hazardType: string): hazardType is HazardType => {
  return !!(hazardTypes as any)[hazardType]
}

const speedUnits = {
  "km/h": "km/h",
  "mph": "mph",
}


type SpeedUnit = keyof typeof speedUnits

const isValidSpeedUnit = (speedUnit: string): speedUnit is SpeedUnit => {
  return !!(speedUnits as any)[speedUnit]
}

type UnitChooserSettings<T extends string, IsOptional extends boolean> = {
  placeholder: string,
  optional: IsOptional,
  options: { [property in T]: string },
  pureNumber: boolean,
  stringIsValidUnit: (str: string) => str is T
}

type UnitChooserProps<Unit extends string, IsOptional extends boolean, ParsedMeasure extends string> = UnitProps<Unit, IsOptional, ParsedMeasure> & UnitChooserSettings<Unit, IsOptional>

function UnitChooser<Unit extends string, IsOptional extends boolean, ParsedMeasure extends string>(params: UnitChooserProps<Unit, IsOptional, ParsedMeasure>) {
  const keys = Object.keys(params.options)
  const buttons: string[] = []
  keys.forEach(k => params.stringIsValidUnit(k) && buttons.push(params.options[k]))
  const selButton = keys.findIndex((k) => k===params.unit)
  const logger = (args: number) => params.stringIsValidUnit(keys[args]) && params.onChooseUnit(keys[args])
  return <HStack style={{width: "100%"}}>
    <View style={{width:"60%", borderWidth:1, borderColor: "teal"}}>
      <RNE.Input
          errorMessage={(params.isValid && (params.optional || !(typeof params.parsedValue === "string") ) ) ? undefined : "Enter a number"}
          onChangeText={params.onUpdateRawValue}
          value={params.rawValue}
          keyboardType={params.pureNumber ? 'number-pad' : undefined}
          placeholder={params.placeholder}/>
    </View>
    <View style={{width:"30%", borderWidth:1, borderColor: "orange"}}>
      <RNE.ButtonGroup onPress={logger} selectedIndex={selButton} buttons={buttons} />
    </View>
  </HStack>
}

const distanceUnits = {
  "m": "m",
  "km": "km",
  "ft": "ft'in",
  "yd": "yd",
  "mi": "miles"
}


type DistanceUnit = keyof typeof distanceUnits

const isValidDistanceUnit = (distanceUnit: string): distanceUnit is DistanceUnit => {
  return !!(distanceUnits as any)[distanceUnit]
}

const isFloat = /^[0-9]+(.[0-9]+)?$/
const isFtIn = /^[0-9]+('([0-9]+")?)?$/

const isValidSpeed = (input: string) => {
  return !isNaN(+input)
}

const isValidDistance = (distanceUnit: DistanceUnit, distance: string) => {
  switch (distanceUnit) {
    case 'ft':
      return isFtIn.test(distance)
    default:
      return isFloat.test(distance)
  }
}

const DistanceChooser = <IsOptional extends boolean>(params: Omit<UnitChooserProps<DistanceUnit, IsOptional, QualifiedDistance>, 'options' | 'pureNumber' | 'stringIsValidUnit'>) =>
  <UnitChooser {...params} options={distanceUnits} stringIsValidUnit={isValidDistanceUnit} pureNumber={params.unit !== 'ft'}  />
const SpeedChooser = <IsOptional extends boolean>(params: Omit<UnitChooserProps<SpeedUnit, IsOptional, QualifiedSpeed>, 'options' | 'pureNumber' | 'stringIsValidUnit' >) =>
  <UnitChooser {...params} pureNumber={true} options={speedUnits} stringIsValidUnit={isValidSpeedUnit} />


type QualifiedDistance = `${number}` | `${number} m` | `${number} km` | `${number} yd` | `${number} mi` | `${number} ft` | `${number} in` | `${number}'${number}"` | `${number} nmi`
type QualifiedSpeed = `${number}` | `${number} km/h` | `${number} mph` | `${number} kt`

type AdequatelySpecifiedSign =
  { sign: "yield_ahead distance=??", distance?: QualifiedDistance }
  | { sign: "stop_ahead distance=??", distance?: QualifiedDistance }
  | { sign: "signal_ahead distance=??", distance?: QualifiedDistance }
  | { sign: "give_way" }
  | { sign: "give_way,roundabout" }
  | { sign: "stop" }
  | { sign: "maxspeed maxspeed=?!", maxspeed?: QualifiedSpeed }
  | { sign: "maxspeed,city_limit maxspeed=?? name=?! city_limit=begin", maxspeed?: QualifiedSpeed, name: string }
  | { sign: "hazard hazard=?!", hazard: HazardType }

type BasicAffectable = `next ${QualifiedDistance}` | "ahead" | "point to point" | "point to intersection" | "point" | "zone"
type Affectable = BasicAffectable | `${BasicAffectable},${BasicAffectable}`

const signAffects = (adeq: AdequatelySpecifiedSign): Affectable => {
  const sign = adeq.sign
  switch (sign) {
    case "signal_ahead distance=??": {
      return adeq.distance ? `next ${adeq.distance}` : "ahead"
    }
    case "yield_ahead distance=??": {
      return adeq.distance ? `next ${adeq.distance}` : "ahead"
    }
    case "stop_ahead distance=??": {
      return adeq.distance ? `next ${adeq.distance}` : "ahead"
    }
    case "stop": {
      return "point"
    }
    case "give_way,roundabout": {
      return "point"
    }
    case "give_way": {
      return "point"
    }
    case "maxspeed maxspeed=?!": {
      return "point to point"
    }
    case "maxspeed,city_limit maxspeed=?? name=?! city_limit=begin": {
      return "point to point,zone"
    }
    case "hazard hazard=?!": {
      return "point"
    }
    default: {
      const never: never = sign
      throw never
    }
  }
}

const parseSpeed = (signDistance: string, signDistanceType: SpeedUnit): QualifiedSpeed | { error: string } => {
  switch (signDistanceType) {
    case "km/h": {
      const kmh = +signDistance
      if (!isNaN(kmh)) {
        return `${kmh}`
      } else {
        return { error: "km/h were not numeric" }
      }
    }
    default: {
      const dist = +signDistance
      if (!isNaN(dist)) {
        return `${dist} ${signDistanceType}`
      } else {
        return { error: `${signDistanceType} was not numeric` }
      }
    }
  }
}

const parseDistance = (signDistance: string, signDistanceType: DistanceUnit): QualifiedDistance | { error: string } => {
  switch (signDistanceType) {
    case "ft": {
      const posFt = signDistance.indexOf("'")
      const posIn = signDistance.indexOf('"')
      if (posFt === -1 && posIn === -1) {
        //whole string taken as ft
        const ft = +signDistance
        if (!isNaN(ft)) {
          return `${ft} ft`
        } else {
          return { error: "feet were not numeric" }
        }
      } else if (posFt > 0 && (posIn === -1 || posIn === signDistance.length - 1)) {
        //prior to ' taken as foot, afterwards taken as in
        const ft = +signDistance.substring(0, posFt)
        const inn = +signDistance.substring(posFt + 1, posIn === -1 ? undefined : posIn)
        if (!isNaN(ft) && !isNaN(inn)) {
          return `${ft}'${inn}"`
        } else {
          return { error: "feet or inches were not numeric" }
        }
      } else {
        return { error: "invalid feet and inches" }
      }
    }
    case "m": {
      const m = +signDistance
      if (!isNaN(m)) {
        return `${m}`
      } else {
        return { error: "metres were not numeric" }
      }
    }
    default: {
      const dist = +signDistance
      if (!isNaN(dist)) {
        return `${dist} ${signDistanceType}`
      } else {
        return { error: `${signDistanceType} was not numeric` }
      }
    }
  }
}

type DistanceProps<IsOptional extends boolean> = UnitProps<DistanceUnit, IsOptional, QualifiedDistance>

type UnitProps<Unit, IsOptional extends boolean, ParsedValue extends string> = {
  isValid: boolean,
  parsedValue: ParsedValue | {error: string} | (IsOptional extends true ? undefined : never),
  unit: Unit,
  rawValue: string,
  onChooseUnit: (du: Unit) => unknown
  onUpdateRawValue: (rd: string) => unknown
}

type StandardSignFormType = {
  hazardType: HazardType,
  onHazardType: (h: HazardType) => unknown,
  yieldAhead: DistanceProps<true>
  stopAhead: DistanceProps<true>
  signalsAhead: DistanceProps<true>
  maxspeedCityLimit: { maxspeed: SpeedProps<true>, townName: TextProps }
  maxspeed: SpeedProps<false>
}

type SpeedProps<IsOptional extends boolean> = UnitProps<SpeedUnit, IsOptional, QualifiedSpeed>

type TextProps = {
  value: string
  onChangeText: (i: string) => unknown
}

const YieldAheadDistanceForm = (params: StandardSignFormType) => {
  return <DistanceChooser
      {...params.yieldAhead}
      placeholder="Distance to yield"
      optional={true}
       />
}

const StopAheadDistanceForm = (params: StandardSignFormType) => {
  return <DistanceChooser {...params.stopAhead} placeholder="Distance to stop" optional={true} />
}

const SignalAheadDistanceForm = (params: StandardSignFormType) => {
  return <DistanceChooser {...params.signalsAhead} placeholder='distance' optional={true}  />
}

const MaxspeedCitylimitForm = (params: StandardSignFormType) => {
  return <VStack>
    <SpeedChooser {...params.maxspeedCityLimit.maxspeed} placeholder="Speed" optional={true} />
    <RNE.Input {...params.maxspeedCityLimit.townName} placeholder="Town Name" ></RNE.Input>
  </VStack>
}

const Maxspeed = (params: StandardSignFormType) => {
  return <SpeedChooser {...params.maxspeed} placeholder="Speed" optional={false} />
}

const Stop = (params: StandardSignFormType) => {
  return false
}

const Hazard = (params: StandardSignFormType) => {
  const [expanded, setExpanded] = useState(false)
  const hazardTypeLabel = hazardTypes[params.hazardType]

  return <RNE.ListItem.Accordion onPress={() => setExpanded(!expanded)} isExpanded={expanded} content={
    <RNE.ListItem.Content>
      <RNE.ListItem.Title>
        <Text>{hazardTypeLabel}</Text>
      </RNE.ListItem.Title>
    </RNE.ListItem.Content>
  }>
    {Object.keys(hazardTypes).map((k) => isValidHazardType(k) && <RNE.ListItem key={k} onPress={() => params.onHazardType(k)} >
      {/*<RNE.Icon {...signTypeIcon[k]} style={{...signTypeIcon[k].style, width:33}}></RNE.Icon>*/}
      <RNE.ListItem.Content><RNE.ListItem.Title>{hazardTypes[k]}</RNE.ListItem.Title></RNE.ListItem.Content>
    </RNE.ListItem>)}
  </RNE.ListItem.Accordion>
}

const GiveWay = (params: StandardSignFormType) => {
  return false
}

const Roundabout = (params: StandardSignFormType) => {
  return false
}

function FormFor(params: { sign: SignType } & StandardSignFormType) {
  const sign: SignType = params.sign
  console.log(sign, "the sign")
  switch (sign) {
    case "yield_ahead distance=??": {
      return <YieldAheadDistanceForm {...params} />
    }
    case "stop_ahead distance=??": {
      return <StopAheadDistanceForm {...params} />
    }
    case "signal_ahead distance=??": {
      return <SignalAheadDistanceForm {...params} />
    }
    case "maxspeed,city_limit maxspeed=?? name=?! city_limit=begin": {
      return <MaxspeedCitylimitForm {...params} />
    }
    case "maxspeed maxspeed=?!": {
      return <Maxspeed {...params} />
    }
    case "stop": {
      return <Stop {...params} />
    }
    case "hazard hazard=?!": {
      return <Hazard {...params} />
    }
    case "give_way": {
      return <GiveWay {...params} />
    }
    case "give_way,roundabout": {
      return <Roundabout {...params} />
    }
    default:
      const c: never = sign
      throw c
  }
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'green'
  },
  map: {
    height: "75%"
  },
})

export type WayId<T extends number|string = string> = T

type TrafficSignArgsInternal = { "traffic_sign": string, point: string, possibly_affected_ways: string }
export type TrafficSignArgs = { "traffic_sign": SignType, point: GeoJSON.Point, possibly_affected_ways: [WayId, GeoJSON.Point][] }

export const prepareSignArgs = (args: TrafficSignArgs): string => {
  const params: TrafficSignArgsInternal = {
    point: JSON.stringify(args.point),
    traffic_sign: args.traffic_sign,
    possibly_affected_ways: JSON.stringify(args.possibly_affected_ways)
  }
  return new URLSearchParams(params).toString()
}
export const depareSignArgs = (args: TrafficSignArgsInternal): Partial<TrafficSignArgs> => ({
  point: JSON.parse(args.point),
  traffic_sign: isValidValue(args.traffic_sign) ? args.traffic_sign : undefined,
  possibly_affected_ways: JSON.parse(args.possibly_affected_ways),
})

const wants = (adeq: AdequatelySpecifiedSign): { type: "way" | "node", tags: Record<string, string>, erroneous_alternatives?: Record<string, string> } => {
  switch (adeq.sign) {
    case 'yield_ahead distance=??': return { type: "node", tags: { "highway": "give_way" } }
    case 'stop_ahead distance=??': return { type: "node", tags: { "highway": "stop" } }
    case 'signal_ahead distance=??': return { type: "node", tags: { "highway": "traffic_signals" } }
    case 'give_way': return { type: "node", tags: { "highway": "give_way" } }
    case 'give_way,roundabout': return { type: "node", tags: { "highway": "give_way" } }
    case 'stop': return { type: "node", tags: { "highway": "stop" }, erroneous_alternatives: {"highway": "give_way"} }
    case 'maxspeed maxspeed=?!': return { type: "way", tags: adeq.maxspeed ? { "maxspeed": adeq.maxspeed } : {} }
    case 'maxspeed,city_limit maxspeed=?? name=?! city_limit=begin': return { type: "way", tags: adeq.maxspeed ? { "maxspeed": adeq.maxspeed } : {} }
    case 'hazard hazard=?!':
        return { type:"node", tags: {}}
    default:
      const never: never = adeq
      throw never
  }
}

const useCommonSpeedState = () => {
  const [rawValue, onUpdateRawValue] = useState("")
  const [unit, onChooseUnit] = useState<SpeedUnit>("km/h")
  const isValid = isValidSpeed(rawValue)
  return {rawValue, onUpdateRawValue, isValid, unit, onChooseUnit}
}

const useOptionalSpeedState = (): SpeedProps<true> => {
  const state = useCommonSpeedState()
  const parsedValue = state.rawValue !== "" ? parseSpeed(state.rawValue, state.unit) : undefined
  return {...state, parsedValue}
}

const useMandatorySpeedState = (): SpeedProps<false> => {
  const state = useCommonSpeedState()
  const parsedValue = parseSpeed(state.rawValue, state.unit)
  return {...state, parsedValue}
}

const useOptionalDistanceState = (): DistanceProps<true> => {
  const [rawValue, onUpdateRawValue] = useState("")
  const [unit, onChooseUnit] = useState<DistanceUnit>("m")
  const isValid = isValidDistance(unit, rawValue)
  const parsedValue = rawValue !== "" ? parseDistance(rawValue, unit) : undefined
  return {rawValue, onUpdateRawValue, isValid, unit, onChooseUnit, parsedValue}
}

const useMandatoryDistanceState = (): DistanceProps<false> => {
  const [rawValue, onUpdateRawValue] = useState("")
  const [unit, onChooseUnit] = useState<DistanceUnit>("m")
  const isValid = isValidDistance(unit, rawValue)
  const parsedValue = parseDistance(rawValue, unit)
  return {rawValue, onUpdateRawValue, isValid, unit, onChooseUnit, parsedValue}
}

const adequatelySpecifySign = (signType: SignType, signProps: StandardSignFormType): AdequatelySpecifiedSign|{error: string} =>
{
  switch (signType)
  {
    case "stop": return { sign: "stop" }
    case "give_way": return { sign: "give_way" }
    case "give_way,roundabout": return { sign: "give_way,roundabout" }
    case "yield_ahead distance=??": {
      const distance = signProps.yieldAhead.parsedValue
      if (typeof distance === "object" && "error" in distance) return distance
      return {sign: "yield_ahead distance=??", distance}
    }
    case "stop_ahead distance=??": {
      const distance = signProps.stopAhead.parsedValue
      if (typeof distance === "object" && "error" in distance) return distance
      return {sign: "stop_ahead distance=??", distance}
    }
    case "signal_ahead distance=??": {
      const distance = signProps.signalsAhead.parsedValue
      if (typeof distance === "object" && "error" in distance) return distance
      return {sign: "signal_ahead distance=??", distance}
    }
    case "maxspeed maxspeed=?!": {
      const maxspeed = signProps.maxspeed.parsedValue
      if (typeof maxspeed === "object" && "error" in maxspeed) return maxspeed
      return {sign: "maxspeed maxspeed=?!", maxspeed}
    }
    case "maxspeed,city_limit maxspeed=?? name=?! city_limit=begin": {
      const name = signProps.maxspeedCityLimit.townName.value
      const maxspeed = signProps.maxspeedCityLimit.maxspeed.parsedValue
      if (typeof maxspeed === "object" && "error" in maxspeed) return maxspeed
      return {sign: "maxspeed,city_limit maxspeed=?? name=?! city_limit=begin", name, maxspeed}
    }
    case "hazard hazard=?!": {
      return {sign: "hazard hazard=?!", hazard: signProps.hazardType}
    }
    default:
      const c: never = signType
      throw c
  }
}


// noinspection JSUnusedGlobalSymbols
export default function AddSign() {
  const searchParams = depareSignArgs(useLocalSearchParams() as TrafficSignArgsInternal)
  const db = SQLite.useSQLiteContext()

  const queries1 = useRef(new EditPageQueries())
  useEffect(() => {
    queries1.current.setup(db)
    return () => {
      queries1.current.finalize()
    }
  }, [db])


  const [signLocation, setSignLocation] = useState<GeoJSON.Position>(searchParams.point?.coordinates || [0, 0])
  const [mapBounds, onMapBoundChange] = useState<GeoJSON.Feature<GeoJSON.Point, RegionPayload> | undefined>(undefined)

  //const [signType, setSignType] = useState<SignType>('stop')

  const mapViewRef = useRef<MapLibreGL.MapViewRef>(null)

  const centrePoint = searchParams.point?.coordinates || [0, 0]
  const mapStyle = detailedMapStyle({ center: centrePoint, zoom: 16 })


  const waysSource = useRef<MapLibreGL.ShapeSourceRef>(null)
  const interestingNodesSource = useRef<MapLibreGL.ShapeSourceRef>(null)
  const nearestPointsSource = useRef<MapLibreGL.ShapeSourceRef>(null)

  const [ne, sw] = mapBounds ? mapBounds.properties.visibleBounds : [[0, 0], [0, 0]]
  const $maxlon = ne[0]
  const $maxlat = ne[1]
  const $minlon = sw[0]
  const $minlat = sw[1]

  const targetWaysQuery = { $minlon, $minlat, $maxlat, $maxlon }
  const qWays = ReactQuery.useQuery({
    queryKey: ["spatialite", "ways", "query ways with intersections", ...Object.values(targetWaysQuery)],
    enabled: !!mapBounds,
    placeholderData: d => d,
    queryFn: () => queries1.current.doQueryWaysWithIntersections(targetWaysQuery)
  })

  const waysCasing: GeoJSON.Feature<GeoJSON.Polygon, OsmApi.IWay>[] | undefined = qWays.data && qWays.data.parsedCasings.length ? qWays.data.parsedCasings : undefined
  const waysCentreline: GeoJSON.Feature<GeoJSON.LineString, OsmApi.IWay>[] | undefined = qWays.data && qWays.data.parsedCentrelines.length ? qWays.data.parsedCentrelines : undefined
  const waysOthers: Record<WayId, IntersectingWayInfo> = qWays.data && qWays.data.parsedOthers || {}

  function any<T>(them: T[], pred: (t: T) => boolean): boolean {
    for (const it of them) {
      if (pred(it)) return true
    }
    return false
  }

  const tapRoad = (feature: OnPressEvent) => {
    console.log("tapped road", feature.features)
		const featureIds = feature.features.map(f => f.id!.toString())
    if(any(featureIds, f => !stateSettings.selectedWays.includes(f))) {
      dispatchAction({action: "select ways", waysCentreline, signLocation, wayId: featureIds, targetPoints: qNodes.data})
    }
    else {
      dispatchAction({action: "deselect ways", wayId: featureIds})
    }
  }

  const tapAffectedNode = (feature: OnPressEvent) => {
    console.log("tapped node", feature.features)
    const pointId = mapMaybe(feature.features,
        (f): Maybe<NodeId> => {
          const theid = f.id
          if (f.geometry.type === "Point" && isNodeId(theid)) {
            const verifiedid: NodeId = theid
            return {just: verifiedid, type: "just"}
          } else {
            return {type: "nothing"}
          }
        })

    if (pointId.some(p => !stateSettings.selectedNodes.some(q => p === q))) {
      dispatchAction({action: "select nodes", pointId})
    } else {
      dispatchAction({action: "deselect nodes", pointId})
    }
  }

  const mainSignAnnoPointRef = useRef<MapLibreGL.PointAnnotationRef>(null)
  const nearestPointAnnoPointRef = useRef<MapLibreGL.PointAnnotationRef>(null)

  const [stateSettings, dispatchAction] = useReducer<Reducer<State, Action>>(reducer, {selectedWays: [], selectedNodes: [], nearestPoints: {}, direction: undefined, directions: {}})

  const affectableIsNext = function <T extends Affectable>(affectable: T | `next ${QualifiedDistance}`): affectable is `next ${QualifiedDistance}` { 
    return !affectableIsComplex(affectable) && affectable.startsWith("next ") 
  }
  const affectableIsComplex = (affectable: Affectable): affectable is `${BasicAffectable},${BasicAffectable}` => affectable.includes(",")

  // type BasicAffectable = `next ${QualifiedDistance}` | "ahead" | "point to point" | "point to intersection" | "point" | "zone"

  const onActivateNearestPoint = (feature: OnPressEvent) => {
    console.log("tapped nearest point", feature.features, "what information odes it have?")
    const pointId = mapMaybe(feature.features, (f): Maybe<NodeId> => {
      return f.geometry.type === "Point" && isNodeId(f.id) ? { type: "just", just: f.id } : { type: "nothing" }
    })

    if (pointId.some(p => !stateSettings.selectedNodes.some(q => p === q))) {
      dispatchAction({action: "select nodes", pointId})
    } else {
      dispatchAction({action: "deselect nodes", pointId})
    }
  }

  const setNearestPointLocation = (nearestPoint: NearestPoint) => (event: FeaturePayload) => {
    console.log("!>!>>!>>>>>>>>>>>>>>>>>>>>>>I'd be setting the nearest point location, if I knew how", event, nearestPoint)
    if(!waysCentreline) {
      //without centreline wi just have to abort the operation
      dispatchAction({action: "update nearest point", nearestPoint: {...nearestPoint}})
    } else {
      const way = waysCentreline.find(f => f.id === nearestPoint.properties.originalWay)!
      const suppliedNearestPoint: TurfNearestPoint = turf.nearestPointOnLine(way, event.geometry.coordinates)
      const newNearestPoint: NearestPoint = {
        ...suppliedNearestPoint,
        id: nearestPoint.id,
        properties: {...suppliedNearestPoint.properties, originalWay: nearestPoint.properties.originalWay}
      }
      dispatchAction({action: "update nearest point", nearestPoint: newNearestPoint})
    }
  }

  const [signType, setSignType] = useState<SignType>("stop")
  const [signTypesExpanded, setSignTypesExpanded] = useState(false)

  const [hazardType, onHazardType] = useState<HazardType>("children")
  const yieldAhead = useOptionalDistanceState()
  const stopAhead = useOptionalDistanceState()
  const signalsAhead = useOptionalDistanceState()
  const maxspeed = useMandatorySpeedState()
  const [townName, setTownName] = useState<string>('')
  const maxspeedCityLimit = {maxspeed: useOptionalSpeedState(), townName: {value: townName, onChangeText: setTownName}}
  const formProps: StandardSignFormType = {
    hazardType,
    onHazardType,
    yieldAhead,
    stopAhead,
    signalsAhead,
    maxspeed,
    maxspeedCityLimit
  }

  const adequatelySpecifiedSign: AdequatelySpecifiedSign|{error: string} = adequatelySpecifySign(signType, formProps)
  const wanted = "error" in adequatelySpecifiedSign ? undefined : wants(adequatelySpecifiedSign)

  const targetNodesQuery = wanted && { $needle: wanted.tags, $minlon, $minlat, $maxlat, $maxlon }
  const qNodes = ReactQuery.useQuery({
    queryKey: ["spatialite", "nodes", "target nodes", JSON.stringify(targetNodesQuery), "m"],
    queryFn: targetNodesQuery && (() => queries1.current.doFindTargetNodes(targetNodesQuery)),
    enabled: targetNodesQuery && mapBounds && wanted && wanted.type === "node",
    placeholderData: (d) => d
  })

  const nodes: GeoJSON.Feature<GeoJSON.Point, {ways: string[]} & OsmApi.INode>[] | undefined = qNodes.data && qNodes.data.length && qNodes.data || undefined

  const adequatelySpecifiedSignMessage = !("error" in adequatelySpecifiedSign) && (() => {
    const affected = signAffects(adequatelySpecifiedSign)
    console.log("this is the affected", affected, affectableIsComplex(affected), affectableIsNext(affected))
    if (affectableIsComplex(affected)) {
      return <Text>The sign is complex. Affected regions are not yet supported.</Text>
    }
    else if (affectableIsNext(affected)) {
      return <Text>The sign affects some continuous distance specified in the sign. Please specify the end point. You may also need to specify ways along the way.</Text>
    } else {
      switch (affected) {
        case "zone":
          return <Text>The sign relates to all ways within an area/zone. Choose points on the bounding ways. Sometimes the points might not be the exact locations of the signs e.g.
            if a speed limit area/zone begins within a short distance of an intersection, it might be better to start or end the speed limit area/zone within a short distance of an intersection.</Text>
        case "point":
          return <Text>The sign relates to a point. This might be a stop/give way line, a speed hump etc. On the affected way, choose the relevant point.</Text>
        case "ahead":
          return <Text>The sign relates to a point ahead. This might be another sign or it could be something like a stop line: in case of ambiguity, it is up to your judgement, interest and concern.
            On the affected way, choose the relevant point.</Text>
        case "point to point":
          return <Text>The sign relates to the ways between two specific points. The end point might be another sign or the end of the road. On the affected ways, choose the start and end points.
            Sometimes the start point might be before the sign e.g. if a speed limit changes within a short distance of an intersection, it might be better to start the speed limit at the intersection.
          </Text>
        case "point to intersection":
          return <Text>The sign relates to the ways between two specific points. The end point might be another sign or an intersection. On the affected ways, choose the start and end points.</Text>
        default:
          const m: never = affected
          console.log("affected is never", m as string)
          throw m
      }
    }
  })()

  const selectedNearestPoints = mapMaybe(Object.entries(stateSettings.nearestPoints), ([wayId, node]): Maybe<NearestPoint> => {
    return node.id && typeof node.id === "string" && isNodeId(node.id) && stateSettings.selectedNodes.includes(node.id) && stateSettings.selectedWays.includes(wayId) ? {type: "just", just: node} : { type: "nothing" }
  })

  const nearestPointsOnSelectedWay = mapMaybe(Object.entries(stateSettings.nearestPoints), ([wayId, node]): Maybe<NearestPoint> => {
    return stateSettings.selectedWays.includes(wayId) ? {type: "just", just: node} : { type: "nothing" }
  })
  const implicitAngleAndDirection = ( (): {angle: number|undefined, direction: Direction|undefined} => {
    const ways = waysCentreline
      ?.filter(w => typeof w.id === "string" && stateSettings.selectedWays.includes(w.id))
      .map(way => {
        const nearestPointOnLine = turf.nearestPointOnLine(way, signLocation)
        const distance = turf.distance(nearestPointOnLine, signLocation)
        return {way, nearestPointOnLine, distance}
      })
    if (!ways) return {angle: undefined, direction: undefined}
    const closestWay = ways
        .sort(({distance: distance1}, {distance: distance2}) => distance1 - distance2)
        [0]
    if (!closestWay) return {angle: undefined, direction: undefined}
    const {way, nearestPointOnLine} = closestWay

    const angle = calculateAngleAtIndex(way, nearestPointOnLine.properties.index)
    const direction = calculateDirectionToNearestIntersection(closestWay, nearestPointOnLine.properties.index, waysOthers[way.id!.toString()])

    return {angle, direction}
  })() //, [actuallyAffectedWays, signLocation, waysCentreline, waysOthers])

  const wayAngle = implicitAngleAndDirection.angle
  const direction = stateSettings.direction || implicitAngleAndDirection.direction || "forward"
  const orientation = direction == "forward" ? 180 : 0
  const angle = wayAngle !== undefined ? (bound(wayAngle + 90 + orientation, 0, 360)) : undefined
  const radians = angle === undefined ? undefined : angle * Math.PI / 180

  const topgradeSign: Record<string, string>|false = !("error" in adequatelySpecifiedSign) && angle !== undefined &&
      (() => {
        const {sign, ...otherProps} = adequatelySpecifiedSign
        return {... otherProps, traffic_sign: sign, direction: bound(angle+180, 0, 360).toFixed(0)}
      })()

  const highwaymarker: undefined|Record<string, string> = !stateSettings.selectedNodes.length && !("error" in adequatelySpecifiedSign) ? (() => {
    const marker = wants(adequatelySpecifiedSign)
    if(marker.type!=="node") return
    return {... marker.tags, direction: direction}

  })() : undefined


  useEffect(() => {
    mainSignAnnoPointRef.current?.refresh()
    console.log("angle", angle)
  }, [angle])


  return (
    <View >
      <VStack>
        <VStack className="v-half">
          <>
          <RNE.ListItem.Accordion onPress={() => setSignTypesExpanded(!signTypesExpanded)} isExpanded={signTypesExpanded} content={
            <RNE.ListItem.Content>
              <RNE.ListItem.Title>
                <Text>{signTypes[signType]}</Text>
              </RNE.ListItem.Title>
            </RNE.ListItem.Content>
          }>
              {Object.keys(signTypes).map((k) => isValidValue(k) && <RNE.ListItem key={k} onPress={() => {setSignType(k); setSignTypesExpanded(false)}} >
                <RNE.Icon {...signTypeIcon[k]} style={{...signTypeIcon[k].style, width:33}}></RNE.Icon>
                <RNE.ListItem.Content><RNE.ListItem.Title>{signTypes[k]}</RNE.ListItem.Title></RNE.ListItem.Content>
              </RNE.ListItem>)}
          </RNE.ListItem.Accordion>
          </>
          <FormFor sign={signType} {...formProps} />
          <Text>{JSON.stringify(adequatelySpecifiedSign)}</Text>
          <Text>{JSON.stringify(angle)}</Text>
          <Text>{JSON.stringify(topgradeSign)}</Text>
          <Text>{JSON.stringify(highwaymarker)}</Text>
          {adequatelySpecifiedSignMessage}
          <Text>Welcome to the add sign view</Text>
          <Text>{JSON.stringify(searchParams)}</Text>
        </VStack>
        <VStack className="v-half" >
          <MapLibreGL.MapView
            style={styles.map}
            onRegionDidChange={onMapBoundChange}
            ref={mapViewRef}
            logoEnabled={true}
            styleJSON={JSON.stringify(mapStyle)}
          >
            <MapLibreGL.Camera minZoomLevel={14} maxZoomLevel={20} zoomLevel={17} centerCoordinate={centrePoint} />
            {waysCasing && <MapLibreGL.ShapeSource
              id="roadcasing"
              shape={{ type: "FeatureCollection", features: waysCasing }}
              ref={waysSource}
              onPress={tapRoad}
            >
              <MapLibreGL.FillLayer
                id="roadcasingfill"
                layerIndex={10}
                style={roadcasingsLayerStyle(stateSettings.selectedWays)}
              />

            </MapLibreGL.ShapeSource>}
            {nodes && <MapLibreGL.ShapeSource
              id="interestingNodes"
              shape={{ type: "FeatureCollection", features: nodes }}
              onPress={tapAffectedNode}
              ref={interestingNodesSource}
            >
              <MapLibreGL.CircleLayer
                id="points"
                layerIndex={20}
                style={selectableCircleLayerStyle(stateSettings.selectedNodes)}
              />

            </MapLibreGL.ShapeSource>}
            <MapLibreGL.ShapeSource
              id="nearestPoints"
              shape={{ type: "FeatureCollection", features: nearestPointsOnSelectedWay
              }}
              ref={nearestPointsSource}
              onPress={onActivateNearestPoint}
            >
              <MapLibreGL.CircleLayer
                id="nearestNodes"
                layerIndex={30}
                style={nearestPointsCircleLayerStyle(stateSettings.selectedNodes)}
              />

            </MapLibreGL.ShapeSource>
            {selectedNearestPoints.map(nearestPoint => <MapLibreGL.PointAnnotation
                key={nearestPoint.id}
                ref={nearestPointAnnoPointRef}
                onSelected={e => console.log("selected", e)}
                onDragEnd={setNearestPointLocation(nearestPoint)}
                id={`nearestpoint-${nearestPoint.id}`}
                coordinate={nearestPoint.geometry.coordinates}
                draggable={true} >
              <View>
                  <Svg.Svg  height="10" width="10" viewBox="0 0 100 100" >
                    <Svg.Circle cx="50" cy="50" r="43" stroke="orange" strokeWidth="14" fill="yellow" />
                  </Svg.Svg>
              </View> 
            </MapLibreGL.PointAnnotation>)}
            <MapLibreGL.PointAnnotation key={angle} ref={mainSignAnnoPointRef} onDragEnd={e => setSignLocation(e.geometry.coordinates)} id="centrepoint" coordinate={signLocation} draggable={true} >
              <View>
                  <Svg.Svg  height="25" width="25" viewBox="0 0 100 100" >
                    <Svg.Defs>
                      <Svg.Marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                        <Svg.Path d="M 0 0 L 10 5 L 0 10 z" />
                      </Svg.Marker>
                    </Svg.Defs>
                    <Svg.Circle cx="50" cy="50" r="43" stroke="blue" strokeWidth="14" fill="green" />
                    {radians !== undefined ?
                    <Svg.Line
                    markerEnd='url(#arrow)'
                    stroke={angle !== 0 ? "orange" : "black"} strokeWidth="10"
                    x1={50 + (43) * Math.cos(radians+Math.PI)} y1={50 + (43) * Math.sin(radians+Math.PI)}
                    x2={50 + (43) * Math.cos(radians)} y2={50 + (43) * Math.sin(radians)}></Svg.Line>
                    :  false }
                  </Svg.Svg>
              </View> 
            </MapLibreGL.PointAnnotation>
          </MapLibreGL.MapView>
        </VStack>
      </VStack>
    </View>
  );
}



const calculateAngleAtIndex = (way: GeoJSON.Feature<GeoJSON.LineString, OsmApi.IWay>, ix: number) => {
  const otherIx = ix + 1 >= way.geometry.coordinates.length ? ix - 1 : ix + 1
  const nextIx = Math.max(ix, otherIx)
  const prevIx = Math.min(ix, otherIx)
  const next = way.geometry.coordinates[nextIx]
  const prev = way.geometry.coordinates[prevIx]
  return bound(turf.rhumbBearing(prev, next), 0, 360)
}

const calculateDirectionToNearestIntersection = ({way, nearestPointOnLine}: {way: GeoJSON.Feature<GeoJSON.LineString, OsmApi.IWay>, nearestPointOnLine: TurfNearestPoint}, ix: number, intersectedWays: IntersectingWayInfo) => {
  const wayIntersections: undefined|GeoJSON.Feature<GeoJSON.Point, {ix: number}>[] =
      mapMaybe(intersectedWays, (wna): Maybe<GeoJSON.Feature<GeoJSON.Point, {ix: number}>> => {
        return wna.others
            ? {type:"just", just: {type: "Feature", properties: {ix: wna.ix}, geometry: {type: "Point", coordinates: way.geometry.coordinates[wna.ix]}}}
            : {type: "nothing"}
      })
  if(!wayIntersections) return undefined
  console.log("theoretically nearest point", nearestPointOnLine)
  console.log("wayintersections", wayIntersections)
  const nearestIntersection = turf.nearestPoint(nearestPointOnLine, {type: "FeatureCollection", features: wayIntersections})
  //const orientation = nodes?.filter(f => f.id == $node_id && (f.properties.tags || {})["direction"] == "backward").length ? 180 : 0
  const trueIx = ix
  if (nearestPointOnLine.properties.location === 0) return 'backward'
  if (nearestPointOnLine.properties.index  === way.geometry.coordinates.length - 1) return  'forward'
  return trueIx < wayIntersections[nearestIntersection.properties.featureIndex].properties.ix ? 'forward' : 'backward'
}
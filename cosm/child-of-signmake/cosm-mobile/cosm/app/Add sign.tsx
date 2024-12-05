import React, { useState, useReducer, useRef, useEffect } from 'react'
import * as Svg from 'react-native-svg'
import * as OsmApi from "@/scripts/clients";
import type { RegionPayload } from '@maplibre/maplibre-react-native/src/components/MapView';
import MapLibreGL from '@maplibre/maplibre-react-native';
import { Text, View, Pressable, StyleSheet, ViewProps } from "react-native";
import { Link, useLocalSearchParams } from "expo-router";
import * as SQLite from 'expo-sqlite'
import { ChevronDownIcon } from 'lucide-react-native';
import { debug, EditPageQueries } from '@/components/queries';
import { OnPressEvent } from '@maplibre/maplibre-react-native/src/types/OnPressEvent';
import * as turf from '@turf/turf'
import * as RNE from '@rneui/themed'

const VStack = ({children, ...props}: React.PropsWithChildren<ViewProps>) => 
  <View {...props} style={Object.assign(props.style || {}, {flexDirection: 'column'})}>{children}</View>

const HStack = ({children, ...props}: React.PropsWithChildren<ViewProps>) => 
  <View {...props} style={Object.assign(props.style || {}, {width: 200, height:50, flexDirection: 'row'})}>{children}</View>

type DirectionState = {direction: Direction, directions: Partial<Record<DirectionOrigin, Direction>>}
type LearnDirection = { type: DirectionOrigin, direction: Direction }
type ForgetDirection = { type: DirectionOrigin, direction?: undefined }
type SetDirection = LearnDirection | ForgetDirection
const directionReducer = (state: DirectionState, action: SetDirection): DirectionState => {
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
type DirectionSpecification  = { direction: Direction, origin: DirectionOrigin }

type FeaturePayload = GeoJSON.Feature<
GeoJSON.Point,
{
  screenPointX: number;
  screenPointY: number;
}>


type NearestPoint = GeoJSON.Feature<GeoJSON.Point, {
    dist: number;
    index: number;
    location: number;
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

const roadcasingsLayerStyle = (activeWayIds: string[], inactiveWayIds: string[]): MapLibreGL.FillLayerStyle => ({
  fillColor: ["case", ["in", ["id"], ["literal", activeWayIds]], "yellow", ["in", ["id"], ["literal", inactiveWayIds]], "gray", "lightgray"],
  fillOpacity: 0.24,
})
const nearestPointsCircleLayerStyle: (nodeIds: string[]) => MapLibreGL.CircleLayerStyle = (nodeIds) => ({
    circleColor: ["case", ["in", ["id"], ["literal", nodeIds]], "green", "gray"],
    circleOpacity: 0.84,
    circleStrokeWidth: 2,
    circleStrokeColor: "white",
    circleRadius: 7,
    circlePitchAlignment: "map"
})

const selectableCircleLayerStyle: (nodeIds: string[]) => MapLibreGL.CircleLayerStyle = (nodeIds) => ({
    circleColor: ["case", ["in", ["id"], ["literal", nodeIds]], "green", "gray"],
    circleOpacity: 0.84,
    circleStrokeWidth: 2,
    circleStrokeColor: "white",
    circleRadius: 5,
    circlePitchAlignment: "map"
})

const circleLayerStyle: Record<string, MapLibreGL.CircleLayerStyle> = {
  red: {
    circleColor: "red",
    circleOpacity: 1,
    circleStrokeWidth: 2,
    circleStrokeColor: "white",
    circleRadius: 5,
    circlePitchAlignment: "map",
  },
  gray: {
    circleColor: "gray",
    circleOpacity: 0.84,
    circleStrokeWidth: 2,
    circleStrokeColor: "white",
    circleRadius: 5,
    circlePitchAlignment: "map"
  },
  green: {
    circleColor: "gray",
    circleOpacity: 0.84,
    circleStrokeWidth: 2,
    circleStrokeColor: "white",
    circleRadius: 5,
    circlePitchAlignment: "map"
  }
}

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

type UnitChooserProps<T extends string> =
  {
    placeholder: string,
    optional: boolean,
    options: { [property in T]: string },
    pureNumber: boolean,
    inputIsValid: boolean,
    inputDistance: string,
    onInputDistance: (distance: string) => void,
    isValid: (option: string) => option is T,
    distanceUnit: T,
    onChooseDistanceUnit: (distanceUnit: T) => any
  }
function UnitChooser<T extends string>(params: UnitChooserProps<T>) {
  const keys = Object.keys(params.options)
  const buttons: string[] = []
  keys.forEach(k => params.isValid(k) && buttons.push(params.options[k]))
  const selButton = keys.findIndex((k) => k===params.distanceUnit)
  const logger = (args: number) => params.isValid(keys[args]) && params.onChooseDistanceUnit(keys[args])
  return <HStack style={{width: "100%"}}>
    <View style={{flexGrow: 3, width:"100%", borderColor: "black"}}><RNE.Input errorMessage={(params.inputIsValid && (params.optional || params.inputDistance !== "") ) ? undefined : "Enter a number"} onChangeText={params.onInputDistance} value={params.inputDistance} keyboardType={params.pureNumber ? 'number-pad' : undefined} placeholder={params.placeholder}></RNE.Input></View>
    <RNE.ButtonGroup onPress={logger} containerStyle={{width: "100%"}} selectedIndex={selButton} buttons={buttons}></RNE.ButtonGroup>
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

const isNumber = /^[0-9]+(.[0-9]+)?$/
const isFtIn = /^[0-9]+('([0-9]+")?)?$/

const isValidDistance = (distanceUnit: DistanceUnit, distance: string) => {
  switch (distanceUnit) {
    case 'ft':
      return isFtIn.test(distance)
    default:
      return isNumber.test(distance)
  }
}

const DistanceChooser = (params: Omit<UnitChooserProps<DistanceUnit>, 'options' | 'isValid' | 'pureNumber' | 'inputIsValid'>) =>
  <UnitChooser {...params} options={distanceUnits} isValid={isValidDistanceUnit} pureNumber={params.distanceUnit !== 'ft'} inputIsValid={isValidDistance(params.distanceUnit, params.inputDistance)} />
const SpeedChooser = (params: Omit<UnitChooserProps<SpeedUnit>, 'options' | 'isValid' | 'pureNumber' | 'inputIsValid'>) =>
  <UnitChooser {...params} pureNumber={true} inputIsValid={!isNaN(+params.inputDistance)} options={speedUnits} isValid={isValidSpeedUnit} />


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
    default: {
      const never: never = sign
      return never
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

type StandardSignFormType = { onNewSignDetail?: (signDetails: Partial<AdequatelySpecifiedSign>) => void, onNewAdequatelySpecifiedSign?: (adeq: AdequatelySpecifiedSign) => void }

const YieldAheadDistanceForm = (params: StandardSignFormType) => {
  const [signDistanceType, setSignDistanceUnit] = useState<DistanceUnit>('m')
  const [signDistance, setSignDistance] = useState<string>('')
  useEffect(() => {
    const onNewAdequatelySpecifiedSign = params.onNewAdequatelySpecifiedSign
    if (!onNewAdequatelySpecifiedSign) return
    const dist = signDistance.length === 0 ? undefined : parseDistance(signDistance, signDistanceType)
    if (!(typeof dist === "object" && "error" in dist))
      onNewAdequatelySpecifiedSign({ sign: "signal_ahead distance=??", distance: dist })
  }, [signDistance, signDistanceType])
  return <DistanceChooser placeholder="distance" optional={true} inputDistance={signDistance} onInputDistance={setSignDistance} distanceUnit={signDistanceType} onChooseDistanceUnit={setSignDistanceUnit} />
}

const StopAheadDistanceForm = (params: StandardSignFormType) => {
  const [signDistanceType, setSignDistanceUnit] = useState<DistanceUnit>('m')
  const [signDistance, setSignDistance] = useState<string>('')
  useEffect(() => {
    const onNewAdequatelySpecifiedSign = params.onNewAdequatelySpecifiedSign
    if (!onNewAdequatelySpecifiedSign) return
    const dist = signDistance.length === 0 ? undefined : parseDistance(signDistance, signDistanceType)
    if (!(typeof dist === "object" && "error" in dist))
      onNewAdequatelySpecifiedSign({ sign: "signal_ahead distance=??", distance: dist })
  }, [signDistance, signDistanceType])
  return <DistanceChooser placeholder="Distance" optional={true} inputDistance={signDistance} onInputDistance={setSignDistance} distanceUnit={signDistanceType} onChooseDistanceUnit={setSignDistanceUnit} />
}

const SignalAheadDistanceForm = (params: StandardSignFormType) => {
  const [signDistanceType, setSignDistanceUnit] = useState<DistanceUnit>('m')
  const [signDistance, setSignDistance] = useState<string>('')
  useEffect(() => {
    const onNewAdequatelySpecifiedSign = params.onNewAdequatelySpecifiedSign
    if (!onNewAdequatelySpecifiedSign) return
    const dist = signDistance.length === 0 ? undefined : parseDistance(signDistance, signDistanceType)
    if (!(typeof dist === "object" && "error" in dist))
      onNewAdequatelySpecifiedSign({ sign: "signal_ahead distance=??", distance: dist })
  }, [signDistance, signDistanceType])
  return <DistanceChooser placeholder='distance' optional={true} inputDistance={signDistance} onInputDistance={setSignDistance} distanceUnit={signDistanceType} onChooseDistanceUnit={setSignDistanceUnit} />
}

const MaxspeedCitylimitForm = (params: StandardSignFormType) => {
  const [signDistanceType, setSignDistanceUnit] = useState<SpeedUnit>('km/h')
  const [signDistance, setSignDistance] = useState<string>('')
  const [townName, setTownName] = useState<string>('')
  useEffect(() => {
    const onNewAdequatelySpecifiedSign = params.onNewAdequatelySpecifiedSign
    if (!onNewAdequatelySpecifiedSign) return
    const dist = signDistance.length === 0 ? undefined : parseSpeed(signDistance, signDistanceType)
    if (!(typeof dist === "object" && "error" in dist))
      onNewAdequatelySpecifiedSign({ sign: "maxspeed,city_limit maxspeed=?? name=?! city_limit=begin", maxspeed: dist, name: townName })
  }, [signDistance, signDistanceType, townName])
  return <VStack>
    <SpeedChooser placeholder="Speed" optional={true} inputDistance={signDistance} onInputDistance={setSignDistance} distanceUnit={signDistanceType} onChooseDistanceUnit={setSignDistanceUnit} />
    <RNE.Input placeholder="Town Name" value={townName} onChangeText={setTownName}></RNE.Input>
  </VStack>
}

const Maxspeed = (params: StandardSignFormType) => {
  const [signDistanceType, setSignDistanceUnit] = useState<SpeedUnit>('km/h')
  const [signDistance, setSignDistance] = useState<string>('')
  useEffect(() => {
    const onNewAdequatelySpecifiedSign = params.onNewAdequatelySpecifiedSign
    if (!onNewAdequatelySpecifiedSign) return
    const dist = signDistance.length === 0 ? undefined : parseSpeed(signDistance, signDistanceType)
    if (!(typeof dist === "object" && "error" in dist))
      onNewAdequatelySpecifiedSign({ sign: "maxspeed maxspeed=?!", maxspeed: dist })
  }, [signDistance, signDistanceType])
  return <SpeedChooser placeholder="Speed" optional={false} inputDistance={signDistance} onInputDistance={setSignDistance} distanceUnit={signDistanceType} onChooseDistanceUnit={setSignDistanceUnit} />
}

const Stop = (params: StandardSignFormType) => {
  useEffect(() => {
    const onNewAdequatelySpecifiedSign = params.onNewAdequatelySpecifiedSign
    if (!onNewAdequatelySpecifiedSign) return
    onNewAdequatelySpecifiedSign({ sign: "stop" })
  }, [])
  return false
}

const Hazard = (params: StandardSignFormType) => {
  const [hazardType, setHazardType] = useState<HazardType | undefined>(undefined)
  const hazardTypeLabel = hazardType && hazardTypes[hazardType]

  useEffect(() => {
    const onNewAdequatelySpecifiedSign = params.onNewAdequatelySpecifiedSign
    if (!onNewAdequatelySpecifiedSign) return
    onNewAdequatelySpecifiedSign({ sign: "stop" })
  }, [hazardType])

  return <Text>Hazard presently disabled</Text>
  /*
  return <FormControl className="w-full">
    <FormControlLabel><FormControlLabelText>Hazard</FormControlLabelText></FormControlLabel>
    <Select className="w-full" initialLabel={hazardTypeLabel}
      selectedValue={hazardType}
      onValueChange={(value) => { (value === undefined || isValidHazardType(value)) && setHazardType(value) }} isDisabled={false} isFocused={true}>
      <SelectTrigger variant="outline" size="md">
        <SelectInput placeholder="Select hazard" />
        <SelectIcon className="mr-3" as={ChevronDownIcon} />
      </SelectTrigger>
      <SelectPortal>
        <SelectBackdrop />
        <SelectContent>
          {Object.keys(hazardTypes).map((k) => isValidHazardType(k) && <SelectItem key={k} label={hazardTypes[k]} value={k} />)}
        </SelectContent>
      </SelectPortal>
    </Select>

  </FormControl>
  */
}

const GiveWay = (params: StandardSignFormType) => {
  useEffect(() => {
    const onNewAdequatelySpecifiedSign = params.onNewAdequatelySpecifiedSign
    if (!onNewAdequatelySpecifiedSign) return
    onNewAdequatelySpecifiedSign({ sign: "give_way" })
  }, [])
  return false
}

const Roundabout = (params: StandardSignFormType) => {
  useEffect(() => {
    const onNewAdequatelySpecifiedSign = params.onNewAdequatelySpecifiedSign
    if (!onNewAdequatelySpecifiedSign) return
    onNewAdequatelySpecifiedSign({ sign: "give_way,roundabout" })
  }, [])
  return false
}

type Split<S extends string, D extends string> = S extends `${infer T}${D}${infer U}` ? [T, ...Split<U, D>] : [S];

type SignType2<S extends string> = Split<S, " ">


function FormFor(params: { sign: SignType, onNewSignDetail?: (signDetails: Partial<AdequatelySpecifiedSign>) => void, onNewAdequatelySpecifiedSign?: (adeq: AdequatelySpecifiedSign) => void }) {
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
      return false
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
export type NodeId<T extends number|string> = T

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
    default:
      const never: never = adeq
      return never
  }
}


export default function Settings() {
  const searchParams = depareSignArgs(useLocalSearchParams() as TrafficSignArgsInternal)
  const db = SQLite.useSQLiteContext()

  const queries = useRef(new EditPageQueries())
  useEffect(() => {
    queries.current.setup(db)
    return () => {
      queries.current.finalize()
    }
  }, [db])


  const [signLocation, setSignLocation] = useState<GeoJSON.Position>(searchParams.point?.coordinates || [0, 0])
  const [centrePoint, setCentrePoint] = useState<GeoJSON.Position>(searchParams.point?.coordinates || [0, 0])
  console.log("centre point", centrePoint, searchParams, searchParams.point, typeof searchParams.point)

  const [signType, setSignType] = useState<SignType>('stop')
  const initialLabel = signTypes[signType]

  const [affectedWays, setAffectedWays] = useState<[WayId, GeoJSON.Point, boolean][]>(searchParams.possibly_affected_ways?.map(([wayId, point]) => [wayId, point, false]) || [])

  const mapViewRef = useRef<MapLibreGL.MapViewRef>(null)

  const mapStyle = mapstyle({ center: centrePoint, zoom: 16 })

  const [mapBounds, setMapBounds] = useState<GeoJSON.Feature<GeoJSON.Point, RegionPayload> | undefined>(undefined)

  const [waysCasing, setWaysCasing] = useState<GeoJSON.Feature<GeoJSON.Polygon, OsmApi.IWay>[] | undefined>(undefined)
  const [waysCentreline, setWaysCentreline] = useState<GeoJSON.Feature<GeoJSON.LineString, OsmApi.IWay>[] | undefined>(undefined)
  const [waysOthers, setWaysOthers] = useState<Record<WayId<number>, {ix: number, node_tags: OsmApi.INode, others: WayId<number>, way_tags: OsmApi.IWay}[]>>({})

  const [nodes, setNodes] = useState<GeoJSON.Feature<GeoJSON.Point, {ways: string[]} & OsmApi.INode>[] | undefined>(undefined)

  const waysSource = useRef<MapLibreGL.ShapeSourceRef>(null)
  const interestingNodesSource = useRef<MapLibreGL.ShapeSourceRef>(null)
  const nearestPointsSource = useRef<MapLibreGL.ShapeSourceRef>(null)
  const signNodeSource = useRef<MapLibreGL.ShapeSourceRef>(null)
  const [adequatelySpecifiedSign, setAdequatelySpecifiedSign] = useState<AdequatelySpecifiedSign>({ sign: "stop" })

  useEffect(() => {
    console.log("new map bounds", mapBounds)
    if (!mapBounds) return

    const [ne, sw] = mapBounds.properties.visibleBounds
    const $maxlon = ne[0]
    const $maxlat = ne[1]
    const $minlon = sw[0]
    const $minlat = sw[1]

    const wanted = wants(adequatelySpecifiedSign)
    if (wanted.type == "node") {
      (async () => {
        const r = await queries.current.doFindTargetNodes({ $needle: wanted.tags, $minlon, $minlat, $maxlat, $maxlon })
        const r2 = await r?.getAllAsync() as { geojson: string, ways: string }[] | undefined
        const parsedNodes = r2
          ?.map(geo => {
            const r: GeoJSON.Feature<GeoJSON.Point, {ways: string[]} & OsmApi.INode> = JSON.parse(geo.geojson)
            const ways: (string|number)[] = JSON.parse(geo.ways)
            r.id = r.properties.id.toString()
            r.properties.ways = ways.map(w => w.toString())
            return r
          })
        setNodes(parsedNodes?.length ? parsedNodes : undefined)
      })()
    }

    ; (async () => {
      console.log("async map bounds", mapBounds)
      console.log("do query", mapBounds)
      const waysResult = await queries.current.doQueryWays({ $minlon, $minlat, $maxlat, $maxlon })
      console.log("done query", mapBounds)
      const all = await waysResult?.getAllAsync() as { length: number|null, geojson: string, centreline: string, other_ways: string }[] | undefined
      console.log("all results", all)
      if (!all) return
      const parsedCasings: GeoJSON.Feature<GeoJSON.Polygon, OsmApi.IWay>[] = []
      const parsedCentrelines: GeoJSON.Feature<GeoJSON.LineString, OsmApi.IWay>[] = []
      const parsedOthers: Record<WayId<number>, {ix: number, node_tags: OsmApi.INode, others: WayId<number>, way_tags: OsmApi.IWay}[]> = {}
      all.forEach(geo => {
        const casing: GeoJSON.Feature<GeoJSON.Polygon, OsmApi.IWay> = JSON.parse(geo.geojson)
        const centreline: GeoJSON.Feature<GeoJSON.LineString, OsmApi.IWay> = JSON.parse(geo.centreline)
        const other_ways = JSON.parse(geo.other_ways)
        if(centreline.id) {
          parsedOthers[+(centreline.id)] = other_ways
        }
        console.log("parsed others", other_ways )
        console.log("parsed length (m)", geo.length )
        parsedCasings.push(casing)
        parsedCentrelines.push(centreline)
      })
      setWaysCasing(parsedCasings.length ? parsedCasings : undefined)
      setWaysCentreline(parsedCentrelines.length ? parsedCentrelines : undefined)
      setWaysOthers(parsedOthers)
    })()
  }, [mapBounds, adequatelySpecifiedSign])

  const onMapBoundChange = (feature: GeoJSON.Feature<GeoJSON.Point, RegionPayload>) => {
    console.log('new bounds', feature)
    setMapBounds(feature)
  }

  const [actuallyAffectedWays, setActuallyAffectedWays] = useState<WayId[]>([])
  const [affectableWays, setAffectableWays] = useState<WayId[]>([])
  useEffect(() => {
    const affectableWays: WayId[] = []
    const actuallyAffectedWays: WayId[] = []
    affectedWays.forEach(([wayId, node, isAffected]) => isAffected ? actuallyAffectedWays.push(wayId) : affectableWays.push(wayId))
    setActuallyAffectedWays(actuallyAffectedWays)
    setAffectableWays(affectableWays)

  }, [affectedWays])

  const [nearestPoints, setNearestPoints] = useState<Record<WayId<string>, NearestPoint>>({})
  useEffect( () => {
    const newNearestPoints = {...nearestPoints}
    affectedWays.forEach(([wayId, node, isAffected]) => {
      if(newNearestPoints[wayId]) return
      const way = waysCentreline?.find(w => w.id === wayId)
      if(!way) return
      const closestPoint = turf.nearestPointOnLine(way, signLocation)
      closestPoint.id = `derived-${wayId}`
      newNearestPoints[wayId] = closestPoint
    })
    setNearestPoints(newNearestPoints)
    

  }, [affectedWays, waysCentreline, signLocation])

  function any<T>(them: T[], pred: (t: T) => boolean): boolean {
    for (const it of them) {
      if (pred(it)) return true
    }
    return false
  }

  const tapRoad = (feature: OnPressEvent) => {
    console.log("tapped road", feature.features)
    setAffectedWays(affectedWays.map(([way, node, isAffected]) => [way, node, any(feature.features, f => f.id === way) ? !isAffected : isAffected]))
  }

  const tapAffectedNode = (feature: OnPressEvent) => {
    console.log("tapped node", feature.features)
    setSelectedNodes(selectedNodes.filter(s => !any(feature.features, f => f.id == s)))
  }

  const [selectedNodes, setSelectedNodes] = useState<string[]>([])
  useEffect(() => {
    const newSelectedNodes: string[] = []
    nodes?.forEach(n => { 
      if (n.id && any(actuallyAffectedWays, w => n.properties.ways.includes(w))) {
        newSelectedNodes.push(n.id.toString())
      }
    })
    setSelectedNodes(newSelectedNodes)
  }, [actuallyAffectedWays, nodes])

  useEffect(() => {
    if (nearestPoint && !any(actuallyAffectedWays, aaw => nearestPoints[aaw].id === nearestPoint.id)) {
      setNearestPoint(undefined)
    }
  }, [actuallyAffectedWays])

  const mainSignAnnoPointRef = useRef<MapLibreGL.PointAnnotationRef>(null)
  const nearestPointAnnoPointRef = useRef<MapLibreGL.PointAnnotationRef>(null)
  const [angle, setAngle] = useState<number>(0)
  const [version, setVersion] = useState(0)
  useEffect(() => { setVersion(version+1) }, [angle])

  useEffect(() => {
    mainSignAnnoPointRef.current?.refresh()
    console.log("angle", angle)
  }, [angle])

  const [directionSettings, dispatchDirection] = useReducer(directionReducer, {direction: "forward", directions: {}})
  useEffect( () => {
    console.log("direction settings", directionSettings)
  }, [directionSettings])
  const direction = directionSettings.direction
  const [wayAngle, setWayAngle] = useState(90)

  useEffect( () => {
    const wayId = actuallyAffectedWays[0]
    if(!wayId) return dispatchDirection({type: "inferred"})
    const way = waysCentreline?.find(w => w.id === wayId)
    if (!way) return dispatchDirection({type: "inferred"})
    const theoreticallyNearestPoint = turf.nearestPointOnLine(way, signLocation)
    const wayIntersections: undefined|GeoJSON.Feature<GeoJSON.Point, {ix: number}>[] = (() => {
      const waynodeAnnos = waysOthers[+wayId]

      const wayIntersections: GeoJSON.Feature<GeoJSON.Point, {ix: number}>[] = [] 
      waynodeAnnos.forEach(wna => wna.others && wayIntersections.push({type: "Feature", properties: {ix: wna.ix}, geometry: {type: "Point", coordinates: way.geometry.coordinates[wna.ix]}}))
      return wayIntersections
    })()
    if(!wayIntersections) return dispatchDirection({type: "inferred"})
    console.log("theoretically nearest point", theoreticallyNearestPoint)
    console.log("wayintersections", wayIntersections)
    const nearestIntersection = turf.nearestPoint(theoreticallyNearestPoint, {type: "FeatureCollection", features: wayIntersections}) 
    const ix = theoreticallyNearestPoint.properties.index
    const otherIx = ix + 1 >= way.geometry.coordinates.length ? ix - 1 : ix + 1
    const nextIx = Math.max(ix, otherIx)
    const prevIx = Math.min(ix, otherIx)
    const next = way.geometry.coordinates[nextIx]
    const prev = way.geometry.coordinates[prevIx]
    const angle = turf.rhumbBearing(prev, next)
       //const orientation = nodes?.filter(f => f.id == $node_id && (f.properties.tags || {})["direction"] == "backward").length ? 180 : 0
    const direction = (() => {
      const trueIx = ix
      if (theoreticallyNearestPoint.properties.location === 0) return debug(trueIx.toString(), 'backward')
      if (theoreticallyNearestPoint.properties.index  === way.geometry.coordinates.length - 1) return debug(JSON.stringify([trueIx, way.geometry.coordinates.length]), 'forward')
      return debug(JSON.stringify([trueIx, way.geometry.coordinates.length, nearestIntersection.properties.featureIndex, wayIntersections[nearestIntersection.properties.featureIndex].properties.ix]), trueIx < wayIntersections[nearestIntersection.properties.featureIndex].properties.ix ? 'forward' : 'backward')
    })()
    dispatchDirection({direction, type: "inferred"}) 
    console.log("orientation", direction, nearestIntersection.properties.featureIndex, wayIntersections[nearestIntersection.properties.featureIndex].properties.ix, ix)
    setWayAngle(bound(angle, 0, 360))
  }, [actuallyAffectedWays, signLocation, waysCentreline, waysOthers])

  useEffect( () => {
    const orientation = direction == "forward" ? 180 : 0
    setAngle(bound(wayAngle + 90 + orientation, 0, 360))
    console.log("orientation/direction", direction, directionSettings)
  }, [wayAngle, direction])

  useEffect(() => {
    if (selectedNodes.length !== 1) return dispatchDirection({type: "specified_tag"})

    const $node_id = selectedNodes[0]
    const node = nodes?.find(f => f.id === $node_id)
    console.log("looking at angle poinst", node, $node_id, nodes)
    if(node) {
      const orientation = (node.properties.tags || {})["direction"] 
    console.log("looking at angle poinst", orientation)
      dispatchDirection({type: "specified_tag", direction: ensureDirection(orientation)})
    } else {
    console.log("looking at angle poinst", "noting")
      dispatchDirection({type: "specified_tag"})
    }
  }, [selectedNodes])

  const affectableIsNext = function <T extends Affectable>(affectable: T | `next ${QualifiedDistance}`): affectable is `next ${QualifiedDistance}` { 
    return !affectableIsComplex(affectable) && affectable.startsWith("next ") 
  }
  const affectableIsComplex = (affectable: Affectable): affectable is `${BasicAffectable},${BasicAffectable}` => affectable.includes(",")

  // type BasicAffectable = `next ${QualifiedDistance}` | "ahead" | "point to point" | "point to intersection" | "point" | "zone"
  const adequatelySpecifiedSignMessage = adequatelySpecifiedSign && (() => {
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
          return false
      }
    }
  })()

  const radians = angle * Math.PI / 180

  const [nearestPoint, setNearestPoint] = useState<NearestPoint|undefined>(undefined)
  const onActivateNearestPoint = (event: OnPressEvent) => {
    event.features.forEach(f => { setNearestPoint(f.id === nearestPoint?.id ? undefined : f as NearestPoint) })
  }
  useEffect( () => { console.log("new nearest point", nearestPoint, nearestPoints) }, [nearestPoint] )

  const setNearestPointLocation = (event: FeaturePayload) => {
    const newNearestPoints = Object.fromEntries(Object.keys(nearestPoints).map(wayId => {
      const m = nearestPoints[wayId]
      if (m.id !== undefined && m.id === nearestPoint?.id) {
        const way = waysCentreline?.find(f => f.id === wayId)!
        console.log("interested in setting the nearest point", wayId, way, event.geometry.coordinates)
        const newNearestPoint = turf.nearestPointOnLine(way, event.geometry.coordinates)
        newNearestPoint.id = m.id
        setNearestPoint(newNearestPoint)
        return [wayId, newNearestPoint]
      }
      return [wayId, m]
    }))
    setNearestPoints(newNearestPoints)
  }

  const topgradeSign: Record<string, string> =
   (() => {
    const {sign, ...otherProps} = adequatelySpecifiedSign
    return {... otherProps, traffic_sign: sign, direction: bound(angle+180, 0, 360).toFixed(0)}
   })()

   const highwaymarker: undefined|Record<string, string> = (() => {
    if(selectedNodes.length) return (console.log("there are selected nodes", selectedNodes), undefined)
    if(!nearestPoint) return (console.log("there is no nearest point", nearestPoint), undefined)
    const marker = wants(adequatelySpecifiedSign)
    if(marker.type!=="node") return (console.log("marker tye is not node", marker), undefined)
    return {... marker.tags, direction: direction}

   })()

   const [signTypesExpanded, setSignTypesExpanded] = useState(false)

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
              {Object.keys(signTypes).map((k) => isValidValue(k) && <RNE.ListItem key={k} onPress={() => (setSignType(k), setSignTypesExpanded(false))} >
                <RNE.Icon {...signTypeIcon[k]} style={{...signTypeIcon[k].style, width:"33"}}></RNE.Icon>
                <RNE.ListItem.Content><RNE.ListItem.Title>{signTypes[k]}</RNE.ListItem.Title></RNE.ListItem.Content>
              </RNE.ListItem>)}
          </RNE.ListItem.Accordion>
          </>
          <FormFor onNewAdequatelySpecifiedSign={setAdequatelySpecifiedSign} sign={signType} />
          <Text>{JSON.stringify(adequatelySpecifiedSign)}</Text>
          <Text>{JSON.stringify(angle)}</Text>
          <Text>{JSON.stringify(topgradeSign)}</Text>
          <Text>{JSON.stringify(highwaymarker)}</Text>
          {adequatelySpecifiedSignMessage}
          <Text>Welcome to the add sign view</Text>
          <Text>{JSON.stringify(searchParams)}</Text>
          <Link href="/details" asChild><Pressable><Text>There's no details here, seriously.</Text></Pressable></Link>
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
                style={roadcasingsLayerStyle(actuallyAffectedWays, affectableWays)}
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
                style={selectableCircleLayerStyle(selectedNodes)}
              />

            </MapLibreGL.ShapeSource>}
            {nearestPoints && <MapLibreGL.ShapeSource
              id="nearestPoints"
              shape={{ type: "FeatureCollection", features: Object.values(nearestPoints) }}
              ref={nearestPointsSource}
              onPress={onActivateNearestPoint}
            >
              <MapLibreGL.CircleLayer
                id="nearestNodes"
                layerIndex={30}
                style={nearestPointsCircleLayerStyle(selectedNodes)}
              />

            </MapLibreGL.ShapeSource>}
            {nearestPoint && <MapLibreGL.PointAnnotation key={nearestPoint.id} ref={nearestPointAnnoPointRef} onSelected={e => console.log("selected", e)} onDragEnd={setNearestPointLocation} id="nearestpoint" coordinate={nearestPoint.geometry.coordinates} draggable={true} >
              <View>
                  <Svg.Svg  height="10" width="10" viewBox="0 0 100 100" >
                    <Svg.Circle cx="50" cy="50" r="43" stroke="orange" strokeWidth="14" fill="yellow" />
                  </Svg.Svg>
              </View> 
            </MapLibreGL.PointAnnotation>}
            <MapLibreGL.PointAnnotation key={angle} ref={mainSignAnnoPointRef} onDragEnd={e => setSignLocation(e.geometry.coordinates)} id="centrepoint" coordinate={signLocation} draggable={true} >
              <View>
                  <Svg.Svg  height="25" width="25" viewBox="0 0 100 100" >
                    <Svg.Defs>
                      <Svg.Marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                        <Svg.Path d="M 0 0 L 10 5 L 0 10 z" />
                      </Svg.Marker>
                    </Svg.Defs>
                    <Svg.Circle cx="50" cy="50" r="43" stroke="blue" strokeWidth="14" fill="green" />
                    {angle ?
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

const mapstyle = ({ center, zoom }: { center: GeoJSON.Position, zoom: number }) => ({
  "version": 8,
  "name": "orto",
  "metadata": {},
  "center": center,
  "zoom": zoom,
  "bearing": 0,
  "pitch": 0,
  "light": {
    "anchor": "viewport",
    "color": "white",
    "intensity": 0.4,
    "position": [
      1.15,
      45,
      30
    ]
  },
  "sources": {
    "liberty": {
      type: "vector",
      url: "https://tiles.openfreemap.org/planet",
      maxzoom: 55
    },
    "maptiler": {
      "type": "raster",
      "tiles": [
        "https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=05JAp48NPkytMVvdbLTK"
      ],
      "tileSize": 256,
      "minzoom": 18,
      "maxzoom": 23,
      "attribution": "'<a href=\"https://www.maptiler.com/copyright/\" target=\"_blank\">&copy; MapTiler</a> <a href=\"https://www.openstreetmap.org/copyright\" target=\"_blank\">&copy; OpenStreetMap contributors</a>'"
    },
    "ortoEsri": {
      "type": "raster",
      "tiles": [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
      ],
      "tileSize": 256,
      "maxzoom": 18,
      "attribution": "ESRI &copy; <a href='http://www.esri.com'>ESRI</a>"
    },
    "ortoInstaMaps": {
      "type": "raster",
      "tiles": [
        "https://tilemaps.icgc.cat/mapfactory/wmts/orto_8_12/CAT3857/{z}/{x}/{y}.png"
      ],
      "tileSize": 256,
      "maxzoom": 13
    },
    "ortoICGC": {
      "type": "raster",
      "tiles": [
        "https://geoserveis.icgc.cat/icc_mapesmultibase/noutm/wmts/orto/GRID3857/{z}/{x}/{y}.jpeg"
      ],
      "tileSize": 256,
      "minzoom": 13.1,
      "maxzoom": 20
    },
    "openmaptiles": {
      "type": "vector",
      "url": "https://geoserveis.icgc.cat/contextmaps/basemap.json"
    }
  },
  "sprite": "https://geoserveis.icgc.cat/contextmaps/sprites/sprite@1",
  "glyphs": "https://geoserveis.icgc.cat/contextmaps/glyphs/{fontstack}/{range}.pbf",
  "layers": [
    {
      "id": "background",
      "type": "background",
      "paint": {
        "background-color": "#F4F9F4"
      }
    },
    {
      "id": "maptiler",
      "type": "raster",
      "source": "maptiler",
      "minzoom": 16,
      "maxzoom": 23,
      "layout": {
        "visibility": "visible"
      }
    },
    {
      "id": "ortoEsri",
      "type": "raster",
      "source": "ortoEsri",
      "maxzoom": 16,
      "layout": {
        "visibility": "visible"
      }
    },
    {
      "id": "ortoICGC",
      "type": "raster",
      "source": "ortoICGC",
      "minzoom": 13.1,
      "maxzoom": 19,
      "layout": {
        "visibility": "visible"
      }
    },
    {
      "id": "ortoInstaMaps",
      "type": "raster",
      "source": "ortoInstaMaps",
      "maxzoom": 13,
      "layout": {
        "visibility": "visible"
      }
    },
    {
      "id": "waterway_tunnel",
      "type": "line",
      "source": "openmaptiles",
      "source-layer": "waterway",
      "minzoom": 14,
      "filter": [
        "all",
        [
          "in",
          "class",
          "river",
          "stream",
          "canal"
        ],
        [
          "==",
          "brunnel",
          "tunnel"
        ]
      ],
      "layout": {
        "line-cap": "round"
      },
      "paint": {
        "line-color": "#a0c8f0",
        "line-width": {
          "base": 1.3,
          "stops": [
            [
              13,
              0.5
            ],
            [
              20,
              6
            ]
          ]
        },
        "line-dasharray": [
          2,
          4
        ]
      }
    },
    {
      "id": "waterway-other",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849382550.77"
      },
      "source": "openmaptiles",
      "source-layer": "waterway",
      "filter": [
        "!in",
        "class",
        "canal",
        "river",
        "stream"
      ],
      "layout": {
        "line-cap": "round"
      },
      "paint": {
        "line-color": "#a0c8f0",
        "line-width": {
          "base": 1.3,
          "stops": [
            [
              13,
              0.5
            ],
            [
              20,
              2
            ]
          ]
        }
      }
    },
    {
      "id": "waterway-stream-canal",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849382550.77"
      },
      "source": "openmaptiles",
      "source-layer": "waterway",
      "filter": [
        "all",
        [
          "in",
          "class",
          "canal",
          "stream"
        ],
        [
          "!=",
          "brunnel",
          "tunnel"
        ]
      ],
      "layout": {
        "line-cap": "round"
      },
      "paint": {
        "line-color": "#a0c8f0",
        "line-width": {
          "base": 1.3,
          "stops": [
            [
              13,
              0.5
            ],
            [
              20,
              6
            ]
          ]
        }
      }
    },
    {
      "id": "waterway-river",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849382550.77"
      },
      "source": "openmaptiles",
      "source-layer": "waterway",
      "filter": [
        "all",
        [
          "==",
          "class",
          "river"
        ],
        [
          "!=",
          "brunnel",
          "tunnel"
        ]
      ],
      "layout": {
        "line-cap": "round"
      },
      "paint": {
        "line-color": "#a0c8f0",
        "line-width": {
          "base": 1.2,
          "stops": [
            [
              10,
              0.8
            ],
            [
              20,
              4
            ]
          ]
        },
        "line-opacity": 0.5
      }
    },
    {
      "id": "water-offset",
      "type": "fill",
      "metadata": {
        "mapbox:group": "1444849382550.77"
      },
      "source": "openmaptiles",
      "source-layer": "water",
      "maxzoom": 8,
      "filter": [
        "==",
        "$type",
        "Polygon"
      ],
      "layout": {
        "visibility": "visible"
      },
      "paint": {
        "fill-opacity": 0,
        "fill-color": "#a0c8f0",
        "fill-translate": {
          "base": 1,
          "stops": [
            [
              6,
              [
                2,
                0
              ]
            ],
            [
              8,
              [
                0,
                0
              ]
            ]
          ]
        }
      }
    },
    {
      "id": "water",
      "type": "fill",
      "metadata": {
        "mapbox:group": "1444849382550.77"
      },
      "source": "openmaptiles",
      "source-layer": "water",
      "layout": {
        "visibility": "visible"
      },
      "paint": {
        "fill-color": "hsl(210, 67%, 85%)",
        "fill-opacity": 0
      }
    },
    {
      "id": "water-pattern",
      "type": "fill",
      "metadata": {
        "mapbox:group": "1444849382550.77"
      },
      "source": "openmaptiles",
      "source-layer": "water",
      "layout": {
        "visibility": "visible"
      },
      "paint": {
        "fill-translate": [
          0,
          2.5
        ],
        "fill-pattern": "wave",
        "fill-opacity": 1
      }
    },
    {
      "id": "landcover-ice-shelf",
      "type": "fill",
      "metadata": {
        "mapbox:group": "1444849382550.77"
      },
      "source": "openmaptiles",
      "source-layer": "landcover",
      "filter": [
        "==",
        "subclass",
        "ice_shelf"
      ],
      "layout": {
        "visibility": "visible"
      },
      "paint": {
        "fill-color": "#fff",
        "fill-opacity": {
          "base": 1,
          "stops": [
            [
              0,
              0.9
            ],
            [
              10,
              0.3
            ]
          ]
        }
      }
    },
    {
      "id": "tunnel-service-track-casing",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849354174.1904"
      },
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": [
        "all",
        [
          "==",
          "brunnel",
          "tunnel"
        ],
        [
          "in",
          "class",
          "service",
          "track"
        ]
      ],
      "layout": {
        "line-join": "round"
      },
      "paint": {
        "line-color": "#cfcdca",
        "line-dasharray": [
          0.5,
          0.25
        ],
        "line-width": {
          "base": 1.2,
          "stops": [
            [
              15,
              1
            ],
            [
              16,
              4
            ],
            [
              20,
              11
            ]
          ]
        }
      }
    },
    {
      "id": "tunnel-minor-casing",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849354174.1904"
      },
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": [
        "all",
        [
          "==",
          "brunnel",
          "tunnel"
        ],
        [
          "==",
          "class",
          "minor"
        ]
      ],
      "layout": {
        "line-join": "round"
      },
      "paint": {
        "line-color": "#cfcdca",
        "line-opacity": {
          "stops": [
            [
              12,
              0
            ],
            [
              12.5,
              1
            ]
          ]
        },
        "line-width": {
          "base": 1.2,
          "stops": [
            [
              12,
              0.5
            ],
            [
              13,
              1
            ],
            [
              14,
              4
            ],
            [
              20,
              15
            ]
          ]
        }
      }
    },
    {
      "id": "tunnel-secondary-tertiary-casing",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849354174.1904"
      },
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": [
        "all",
        [
          "==",
          "brunnel",
          "tunnel"
        ],
        [
          "in",
          "class",
          "secondary",
          "tertiary"
        ]
      ],
      "layout": {
        "line-join": "round"
      },
      "paint": {
        "line-color": "#e9ac77",
        "line-opacity": 1,
        "line-width": {
          "base": 1.2,
          "stops": [
            [
              8,
              1.5
            ],
            [
              20,
              17
            ]
          ]
        }
      }
    },
    {
      "id": "tunnel-trunk-primary-casing",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849354174.1904"
      },
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": [
        "all",
        [
          "==",
          "brunnel",
          "tunnel"
        ],
        [
          "in",
          "class",
          "primary",
          "trunk"
        ]
      ],
      "layout": {
        "line-join": "round"
      },
      "paint": {
        "line-color": "#e9ac77",
        "line-width": {
          "base": 1.2,
          "stops": [
            [
              5,
              0.4
            ],
            [
              6,
              0.6
            ],
            [
              7,
              1.5
            ],
            [
              20,
              22
            ]
          ]
        },
        "line-opacity": 0.7
      }
    },
    {
      "id": "tunnel-motorway-casing",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849354174.1904"
      },
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": [
        "all",
        [
          "==",
          "brunnel",
          "tunnel"
        ],
        [
          "==",
          "class",
          "motorway"
        ]
      ],
      "layout": {
        "line-join": "round",
        "visibility": "visible"
      },
      "paint": {
        "line-color": "#e9ac77",
        "line-dasharray": [
          0.5,
          0.25
        ],
        "line-width": {
          "base": 1.2,
          "stops": [
            [
              5,
              0.4
            ],
            [
              6,
              0.6
            ],
            [
              7,
              1.5
            ],
            [
              20,
              22
            ]
          ]
        },
        "line-opacity": 0.5
      }
    },
    {
      "id": "tunnel-path",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849354174.1904"
      },
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": [
        "all",
        [
          "==",
          "$type",
          "LineString"
        ],
        [
          "all",
          [
            "==",
            "brunnel",
            "tunnel"
          ],
          [
            "==",
            "class",
            "path"
          ]
        ]
      ],
      "paint": {
        "line-color": "#cba",
        "line-dasharray": [
          1.5,
          0.75
        ],
        "line-width": {
          "base": 1.2,
          "stops": [
            [
              15,
              1.2
            ],
            [
              20,
              4
            ]
          ]
        }
      }
    },
    {
      "id": "tunnel-service-track",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849354174.1904"
      },
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": [
        "all",
        [
          "==",
          "brunnel",
          "tunnel"
        ],
        [
          "in",
          "class",
          "service",
          "track"
        ]
      ],
      "layout": {
        "line-join": "round"
      },
      "paint": {
        "line-color": "#fff",
        "line-width": {
          "base": 1.2,
          "stops": [
            [
              15.5,
              0
            ],
            [
              16,
              2
            ],
            [
              20,
              7.5
            ]
          ]
        }
      }
    },
    {
      "id": "tunnel-minor",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849354174.1904"
      },
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": [
        "all",
        [
          "==",
          "brunnel",
          "tunnel"
        ],
        [
          "==",
          "class",
          "minor_road"
        ]
      ],
      "layout": {
        "line-join": "round"
      },
      "paint": {
        "line-color": "#fff",
        "line-opacity": 1,
        "line-width": {
          "base": 1.2,
          "stops": [
            [
              13.5,
              0
            ],
            [
              14,
              2.5
            ],
            [
              20,
              11.5
            ]
          ]
        }
      }
    },
    {
      "id": "tunnel-secondary-tertiary",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849354174.1904"
      },
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": [
        "all",
        [
          "==",
          "brunnel",
          "tunnel"
        ],
        [
          "in",
          "class",
          "secondary",
          "tertiary"
        ]
      ],
      "layout": {
        "line-join": "round"
      },
      "paint": {
        "line-color": "#fff4c6",
        "line-width": {
          "base": 1.2,
          "stops": [
            [
              6.5,
              0
            ],
            [
              7,
              0.5
            ],
            [
              20,
              10
            ]
          ]
        }
      }
    },
    {
      "id": "tunnel-trunk-primary",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849354174.1904"
      },
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": [
        "all",
        [
          "==",
          "brunnel",
          "tunnel"
        ],
        [
          "in",
          "class",
          "primary",
          "trunk"
        ]
      ],
      "layout": {
        "line-join": "round"
      },
      "paint": {
        "line-color": "#fff4c6",
        "line-width": {
          "base": 1.2,
          "stops": [
            [
              6.5,
              0
            ],
            [
              7,
              0.5
            ],
            [
              20,
              18
            ]
          ]
        },
        "line-opacity": 0.5
      }
    },
    {
      "id": "tunnel-motorway",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849354174.1904"
      },
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": [
        "all",
        [
          "==",
          "brunnel",
          "tunnel"
        ],
        [
          "==",
          "class",
          "motorway"
        ]
      ],
      "layout": {
        "line-join": "round",
        "visibility": "visible"
      },
      "paint": {
        "line-color": "#ffdaa6",
        "line-width": {
          "base": 1.2,
          "stops": [
            [
              6.5,
              0
            ],
            [
              7,
              0.5
            ],
            [
              20,
              18
            ]
          ]
        },
        "line-opacity": 0.5
      }
    },
    {
      "id": "tunnel-railway",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849354174.1904"
      },
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": [
        "all",
        [
          "==",
          "brunnel",
          "tunnel"
        ],
        [
          "==",
          "class",
          "rail"
        ]
      ],
      "paint": {
        "line-color": "#bbb",
        "line-width": {
          "base": 1.4,
          "stops": [
            [
              14,
              0.4
            ],
            [
              15,
              0.75
            ],
            [
              20,
              2
            ]
          ]
        },
        "line-dasharray": [
          2,
          2
        ]
      }
    },
    {
      "id": "ferry",
      "type": "line",
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": [
        "all",
        [
          "in",
          "class",
          "ferry"
        ]
      ],
      "layout": {
        "line-join": "round",
        "visibility": "visible"
      },
      "paint": {
        "line-color": "rgba(108, 159, 182, 1)",
        "line-width": 1.1,
        "line-dasharray": [
          2,
          2
        ]
      }
    },
    {
      "id": "aeroway-taxiway-casing",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849345966.4436"
      },
      "source": "openmaptiles",
      "source-layer": "aeroway",
      "minzoom": 12,
      "filter": [
        "all",
        [
          "in",
          "class",
          "taxiway"
        ]
      ],
      "layout": {
        "line-cap": "round",
        "line-join": "round",
        "visibility": "visible"
      },
      "paint": {
        "line-color": "rgba(153, 153, 153, 1)",
        "line-width": {
          "base": 1.5,
          "stops": [
            [
              11,
              2
            ],
            [
              17,
              12
            ]
          ]
        },
        "line-opacity": 1
      }
    },
    {
      "id": "aeroway-runway-casing",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849345966.4436"
      },
      "source": "openmaptiles",
      "source-layer": "aeroway",
      "minzoom": 12,
      "filter": [
        "all",
        [
          "in",
          "class",
          "runway"
        ]
      ],
      "layout": {
        "line-cap": "round",
        "line-join": "round",
        "visibility": "visible"
      },
      "paint": {
        "line-color": "rgba(153, 153, 153, 1)",
        "line-width": {
          "base": 1.5,
          "stops": [
            [
              11,
              5
            ],
            [
              17,
              55
            ]
          ]
        },
        "line-opacity": 1
      }
    },
    {
      "id": "aeroway-taxiway",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849345966.4436"
      },
      "source": "openmaptiles",
      "source-layer": "aeroway",
      "minzoom": 4,
      "filter": [
        "all",
        [
          "in",
          "class",
          "taxiway"
        ],
        [
          "==",
          "$type",
          "LineString"
        ]
      ],
      "layout": {
        "line-cap": "round",
        "line-join": "round",
        "visibility": "visible"
      },
      "paint": {
        "line-color": "rgba(255, 255, 255, 1)",
        "line-width": {
          "base": 1.5,
          "stops": [
            [
              11,
              1
            ],
            [
              17,
              10
            ]
          ]
        },
        "line-opacity": {
          "base": 1,
          "stops": [
            [
              11,
              0
            ],
            [
              12,
              1
            ]
          ]
        }
      }
    },
    {
      "id": "aeroway-runway",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849345966.4436"
      },
      "source": "openmaptiles",
      "source-layer": "aeroway",
      "minzoom": 4,
      "filter": [
        "all",
        [
          "in",
          "class",
          "runway"
        ],
        [
          "==",
          "$type",
          "LineString"
        ]
      ],
      "layout": {
        "line-cap": "round",
        "line-join": "round",
        "visibility": "visible"
      },
      "paint": {
        "line-color": "rgba(255, 255, 255, 1)",
        "line-width": {
          "base": 1.5,
          "stops": [
            [
              11,
              4
            ],
            [
              17,
              50
            ]
          ]
        },
        "line-opacity": {
          "base": 1,
          "stops": [
            [
              11,
              0
            ],
            [
              12,
              1
            ]
          ]
        }
      }
    },
    {
      "id": "highway-motorway-link-casing",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849345966.4436"
      },
      "source": "openmaptiles",
      "source-layer": "transportation",
      "minzoom": 12,
      "filter": [
        "all",
        [
          "!in",
          "brunnel",
          "bridge",
          "tunnel"
        ],
        [
          "==",
          "class",
          "motorway_link"
        ]
      ],
      "layout": {
        "line-cap": "round",
        "line-join": "round"
      },
      "paint": {
        "line-color": "#e9ac77",
        "line-opacity": 1,
        "line-width": {
          "base": 1.2,
          "stops": [
            [
              12,
              1
            ],
            [
              13,
              3
            ],
            [
              14,
              4
            ],
            [
              20,
              15
            ]
          ]
        }
      }
    },
    {
      "id": "highway-link-casing",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849345966.4436"
      },
      "source": "openmaptiles",
      "source-layer": "transportation",
      "minzoom": 13,
      "filter": [
        "all",
        [
          "!in",
          "brunnel",
          "bridge",
          "tunnel"
        ],
        [
          "in",
          "class",
          "primary_link",
          "secondary_link",
          "tertiary_link",
          "trunk_link"
        ]
      ],
      "layout": {
        "line-cap": "round",
        "line-join": "round",
        "visibility": "visible"
      },
      "paint": {
        "line-color": "#e9ac77",
        "line-opacity": 1,
        "line-width": {
          "base": 1.2,
          "stops": [
            [
              12,
              1
            ],
            [
              13,
              3
            ],
            [
              14,
              4
            ],
            [
              20,
              15
            ]
          ]
        }
      }
    },
    {
      "id": "highway-minor-casing",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849345966.4436"
      },
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": [
        "all",
        [
          "==",
          "$type",
          "LineString"
        ],
        [
          "all",
          [
            "!=",
            "brunnel",
            "tunnel"
          ],
          [
            "in",
            "class",
            "minor",
            "service",
            "track"
          ]
        ]
      ],
      "layout": {
        "line-cap": "round",
        "line-join": "round"
      },
      "paint": {
        "line-color": "#cfcdca",
        "line-opacity": {
          "stops": [
            [
              12,
              0
            ],
            [
              12.5,
              0
            ]
          ]
        },
        "line-width": {
          "base": 1.2,
          "stops": [
            [
              12,
              0.5
            ],
            [
              13,
              1
            ],
            [
              14,
              4
            ],
            [
              20,
              15
            ]
          ]
        }
      }
    },
    {
      "id": "highway-secondary-tertiary-casing",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849345966.4436"
      },
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": [
        "all",
        [
          "!in",
          "brunnel",
          "bridge",
          "tunnel"
        ],
        [
          "in",
          "class",
          "secondary",
          "tertiary"
        ]
      ],
      "layout": {
        "line-cap": "butt",
        "line-join": "round",
        "visibility": "visible"
      },
      "paint": {
        "line-color": "#e9ac77",
        "line-opacity": 0.5,
        "line-width": {
          "base": 1.2,
          "stops": [
            [
              8,
              1.5
            ],
            [
              20,
              17
            ]
          ]
        }
      }
    },
    {
      "id": "highway-primary-casing",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849345966.4436"
      },
      "source": "openmaptiles",
      "source-layer": "transportation",
      "minzoom": 5,
      "filter": [
        "all",
        [
          "!in",
          "brunnel",
          "bridge",
          "tunnel"
        ],
        [
          "in",
          "class",
          "primary"
        ]
      ],
      "layout": {
        "line-cap": "butt",
        "line-join": "round",
        "visibility": "visible"
      },
      "paint": {
        "line-color": "#e9ac77",
        "line-opacity": {
          "stops": [
            [
              7,
              0
            ],
            [
              8,
              0.6
            ]
          ]
        },
        "line-width": {
          "base": 1.2,
          "stops": [
            [
              7,
              0
            ],
            [
              8,
              0.6
            ],
            [
              9,
              1.5
            ],
            [
              20,
              22
            ]
          ]
        }
      }
    },
    {
      "id": "highway-trunk-casing",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849345966.4436"
      },
      "source": "openmaptiles",
      "source-layer": "transportation",
      "minzoom": 5,
      "filter": [
        "all",
        [
          "!in",
          "brunnel",
          "bridge",
          "tunnel"
        ],
        [
          "in",
          "class",
          "trunk"
        ]
      ],
      "layout": {
        "line-cap": "butt",
        "line-join": "round",
        "visibility": "visible"
      },
      "paint": {
        "line-color": "#e9ac77",
        "line-opacity": {
          "stops": [
            [
              5,
              0
            ],
            [
              6,
              0.5
            ]
          ]
        },
        "line-width": {
          "base": 1.2,
          "stops": [
            [
              5,
              0
            ],
            [
              6,
              0.6
            ],
            [
              7,
              1.5
            ],
            [
              20,
              22
            ]
          ]
        }
      }
    },
    {
      "id": "highway-motorway-casing",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849345966.4436"
      },
      "source": "openmaptiles",
      "source-layer": "transportation",
      "minzoom": 4,
      "filter": [
        "all",
        [
          "!in",
          "brunnel",
          "bridge",
          "tunnel"
        ],
        [
          "==",
          "class",
          "motorway"
        ]
      ],
      "layout": {
        "line-cap": "butt",
        "line-join": "round",
        "visibility": "visible"
      },
      "paint": {
        "line-color": "#e9ac77",
        "line-width": {
          "base": 1.2,
          "stops": [
            [
              4,
              0
            ],
            [
              5,
              0.4
            ],
            [
              6,
              0.6
            ],
            [
              7,
              1.5
            ],
            [
              20,
              22
            ]
          ]
        },
        "line-opacity": {
          "stops": [
            [
              4,
              0
            ],
            [
              5,
              0.5
            ]
          ]
        }
      }
    },
    {
      "id": "highway-path",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849345966.4436"
      },
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": [
        "all",
        [
          "==",
          "$type",
          "LineString"
        ],
        [
          "all",
          [
            "!in",
            "brunnel",
            "bridge",
            "tunnel"
          ],
          [
            "==",
            "class",
            "path"
          ]
        ]
      ],
      "paint": {
        "line-color": "#cba",
        "line-dasharray": [
          1.5,
          0.75
        ],
        "line-width": {
          "base": 1.2,
          "stops": [
            [
              15,
              1.2
            ],
            [
              20,
              4
            ]
          ]
        }
      }
    },
    {
      "id": "highway-motorway-link",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849345966.4436"
      },
      "source": "openmaptiles",
      "source-layer": "transportation",
      "minzoom": 12,
      "filter": [
        "all",
        [
          "!in",
          "brunnel",
          "bridge",
          "tunnel"
        ],
        [
          "==",
          "class",
          "motorway_link"
        ]
      ],
      "layout": {
        "line-cap": "round",
        "line-join": "round"
      },
      "paint": {
        "line-color": "#fc8",
        "line-width": {
          "base": 1.2,
          "stops": [
            [
              12.5,
              0
            ],
            [
              13,
              1.5
            ],
            [
              14,
              2.5
            ],
            [
              20,
              11.5
            ]
          ]
        }
      }
    },
    {
      "id": "highway-link",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849345966.4436"
      },
      "source": "openmaptiles",
      "source-layer": "transportation",
      "minzoom": 13,
      "filter": [
        "all",
        [
          "!in",
          "brunnel",
          "bridge",
          "tunnel"
        ],
        [
          "in",
          "class",
          "primary_link",
          "secondary_link",
          "tertiary_link",
          "trunk_link"
        ]
      ],
      "layout": {
        "line-cap": "round",
        "line-join": "round",
        "visibility": "visible"
      },
      "paint": {
        "line-color": "#fea",
        "line-width": {
          "base": 1.2,
          "stops": [
            [
              12.5,
              0
            ],
            [
              13,
              1.5
            ],
            [
              14,
              2.5
            ],
            [
              20,
              11.5
            ]
          ]
        }
      }
    },
    {
      "id": "highway-minor",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849345966.4436"
      },
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": [
        "all",
        [
          "==",
          "$type",
          "LineString"
        ],
        [
          "all",
          [
            "!=",
            "brunnel",
            "tunnel"
          ],
          [
            "in",
            "class",
            "minor",
            "service",
            "track"
          ]
        ]
      ],
      "layout": {
        "line-cap": "round",
        "line-join": "round"
      },
      "paint": {
        "line-color": "#fff",
        "line-opacity": 0.5,
        "line-width": {
          "base": 1.2,
          "stops": [
            [
              13.5,
              0
            ],
            [
              14,
              2.5
            ],
            [
              20,
              11.5
            ]
          ]
        }
      }
    },
    {
      "id": "highway-secondary-tertiary",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849345966.4436"
      },
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": [
        "all",
        [
          "!in",
          "brunnel",
          "bridge",
          "tunnel"
        ],
        [
          "in",
          "class",
          "secondary",
          "tertiary"
        ]
      ],
      "layout": {
        "line-cap": "round",
        "line-join": "round",
        "visibility": "visible"
      },
      "paint": {
        "line-color": "#fea",
        "line-width": {
          "base": 1.2,
          "stops": [
            [
              6.5,
              0
            ],
            [
              8,
              0.5
            ],
            [
              20,
              13
            ]
          ]
        },
        "line-opacity": 0.5
      }
    },
    {
      "id": "highway-primary",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849345966.4436"
      },
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": [
        "all",
        [
          "==",
          "$type",
          "LineString"
        ],
        [
          "all",
          [
            "!in",
            "brunnel",
            "bridge",
            "tunnel"
          ],
          [
            "in",
            "class",
            "primary"
          ]
        ]
      ],
      "layout": {
        "line-cap": "round",
        "line-join": "round",
        "visibility": "visible"
      },
      "paint": {
        "line-color": "#fea",
        "line-width": {
          "base": 1.2,
          "stops": [
            [
              8.5,
              0
            ],
            [
              9,
              0.5
            ],
            [
              20,
              18
            ]
          ]
        },
        "line-opacity": 0
      }
    },
    {
      "id": "highway-trunk",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849345966.4436"
      },
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": [
        "all",
        [
          "==",
          "$type",
          "LineString"
        ],
        [
          "all",
          [
            "!in",
            "brunnel",
            "bridge",
            "tunnel"
          ],
          [
            "in",
            "class",
            "trunk"
          ]
        ]
      ],
      "layout": {
        "line-cap": "round",
        "line-join": "round",
        "visibility": "visible"
      },
      "paint": {
        "line-color": "#fea",
        "line-width": {
          "base": 1.2,
          "stops": [
            [
              6.5,
              0
            ],
            [
              7,
              0.5
            ],
            [
              20,
              18
            ]
          ]
        },
        "line-opacity": 0.5
      }
    },
    {
      "id": "highway-motorway",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849345966.4436"
      },
      "source": "openmaptiles",
      "source-layer": "transportation",
      "minzoom": 5,
      "filter": [
        "all",
        [
          "==",
          "$type",
          "LineString"
        ],
        [
          "all",
          [
            "!in",
            "brunnel",
            "bridge",
            "tunnel"
          ],
          [
            "==",
            "class",
            "motorway"
          ]
        ]
      ],
      "layout": {
        "line-cap": "round",
        "line-join": "round",
        "visibility": "visible"
      },
      "paint": {
        "line-color": "#fc8",
        "line-width": {
          "base": 1.2,
          "stops": [
            [
              6.5,
              0
            ],
            [
              7,
              0.5
            ],
            [
              20,
              18
            ]
          ]
        },
        "line-opacity": 0.5
      }
    },
    {
      "id": "railway-transit",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849345966.4436"
      },
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": [
        "all",
        [
          "==",
          "$type",
          "LineString"
        ],
        [
          "all",
          [
            "==",
            "class",
            "transit"
          ],
          [
            "!in",
            "brunnel",
            "tunnel"
          ]
        ]
      ],
      "layout": {
        "visibility": "visible"
      },
      "paint": {
        "line-color": "hsla(0, 0%, 73%, 0.77)",
        "line-width": {
          "base": 1.4,
          "stops": [
            [
              14,
              0.4
            ],
            [
              20,
              1
            ]
          ]
        }
      }
    },
    {
      "id": "railway-transit-hatching",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849345966.4436"
      },
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": [
        "all",
        [
          "==",
          "$type",
          "LineString"
        ],
        [
          "all",
          [
            "==",
            "class",
            "transit"
          ],
          [
            "!in",
            "brunnel",
            "tunnel"
          ]
        ]
      ],
      "layout": {
        "visibility": "visible"
      },
      "paint": {
        "line-color": "hsla(0, 0%, 73%, 0.68)",
        "line-dasharray": [
          0.2,
          8
        ],
        "line-width": {
          "base": 1.4,
          "stops": [
            [
              14.5,
              0
            ],
            [
              15,
              2
            ],
            [
              20,
              6
            ]
          ]
        }
      }
    },
    {
      "id": "railway-service",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849345966.4436"
      },
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": [
        "all",
        [
          "==",
          "$type",
          "LineString"
        ],
        [
          "all",
          [
            "==",
            "class",
            "rail"
          ],
          [
            "has",
            "service"
          ]
        ]
      ],
      "paint": {
        "line-color": "hsla(0, 0%, 73%, 0.77)",
        "line-width": {
          "base": 1.4,
          "stops": [
            [
              14,
              0.4
            ],
            [
              20,
              1
            ]
          ]
        }
      }
    },
    {
      "id": "railway-service-hatching",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849345966.4436"
      },
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": [
        "all",
        [
          "==",
          "$type",
          "LineString"
        ],
        [
          "all",
          [
            "==",
            "class",
            "rail"
          ],
          [
            "has",
            "service"
          ]
        ]
      ],
      "layout": {
        "visibility": "visible"
      },
      "paint": {
        "line-color": "hsla(0, 0%, 73%, 0.68)",
        "line-dasharray": [
          0.2,
          8
        ],
        "line-width": {
          "base": 1.4,
          "stops": [
            [
              14.5,
              0
            ],
            [
              15,
              2
            ],
            [
              20,
              6
            ]
          ]
        }
      }
    },
    {
      "id": "railway",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849345966.4436"
      },
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": [
        "all",
        [
          "==",
          "$type",
          "LineString"
        ],
        [
          "all",
          [
            "!has",
            "service"
          ],
          [
            "!in",
            "brunnel",
            "bridge",
            "tunnel"
          ],
          [
            "==",
            "class",
            "rail"
          ]
        ]
      ],
      "paint": {
        "line-color": "#bbb",
        "line-width": {
          "base": 1.4,
          "stops": [
            [
              14,
              0.4
            ],
            [
              15,
              0.75
            ],
            [
              20,
              2
            ]
          ]
        }
      }
    },
    {
      "id": "railway-hatching",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849345966.4436"
      },
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": [
        "all",
        [
          "==",
          "$type",
          "LineString"
        ],
        [
          "all",
          [
            "!has",
            "service"
          ],
          [
            "!in",
            "brunnel",
            "bridge",
            "tunnel"
          ],
          [
            "==",
            "class",
            "rail"
          ]
        ]
      ],
      "paint": {
        "line-color": "#bbb",
        "line-dasharray": [
          0.2,
          8
        ],
        "line-width": {
          "base": 1.4,
          "stops": [
            [
              14.5,
              0
            ],
            [
              15,
              3
            ],
            [
              20,
              8
            ]
          ]
        }
      }
    },
    {
      "id": "bridge-motorway-link-casing",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849334699.1902"
      },
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": [
        "all",
        [
          "==",
          "brunnel",
          "bridge"
        ],
        [
          "==",
          "class",
          "motorway_link"
        ]
      ],
      "layout": {
        "line-join": "round"
      },
      "paint": {
        "line-color": "#e9ac77",
        "line-opacity": 1,
        "line-width": {
          "base": 1.2,
          "stops": [
            [
              12,
              1
            ],
            [
              13,
              3
            ],
            [
              14,
              4
            ],
            [
              20,
              15
            ]
          ]
        }
      }
    },
    {
      "id": "bridge-link-casing",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849334699.1902"
      },
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": [
        "all",
        [
          "==",
          "brunnel",
          "bridge"
        ],
        [
          "in",
          "class",
          "primary_link",
          "secondary_link",
          "tertiary_link",
          "trunk_link"
        ]
      ],
      "layout": {
        "line-join": "round"
      },
      "paint": {
        "line-color": "#e9ac77",
        "line-opacity": 1,
        "line-width": {
          "base": 1.2,
          "stops": [
            [
              12,
              1
            ],
            [
              13,
              3
            ],
            [
              14,
              4
            ],
            [
              20,
              15
            ]
          ]
        }
      }
    },
    {
      "id": "bridge-secondary-tertiary-casing",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849334699.1902"
      },
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": [
        "all",
        [
          "==",
          "brunnel",
          "bridge"
        ],
        [
          "in",
          "class",
          "secondary",
          "tertiary"
        ]
      ],
      "layout": {
        "line-join": "round"
      },
      "paint": {
        "line-color": "#e9ac77",
        "line-opacity": 1,
        "line-width": {
          "base": 1.2,
          "stops": [
            [
              8,
              1.5
            ],
            [
              20,
              28
            ]
          ]
        }
      }
    },
    {
      "id": "bridge-trunk-primary-casing",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849334699.1902"
      },
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": [
        "all",
        [
          "==",
          "brunnel",
          "bridge"
        ],
        [
          "in",
          "class",
          "primary",
          "trunk"
        ]
      ],
      "layout": {
        "line-join": "round"
      },
      "paint": {
        "line-color": "hsl(28, 76%, 67%)",
        "line-width": {
          "base": 1.2,
          "stops": [
            [
              5,
              0.4
            ],
            [
              6,
              0.6
            ],
            [
              7,
              1.5
            ],
            [
              20,
              26
            ]
          ]
        }
      }
    },
    {
      "id": "bridge-motorway-casing",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849334699.1902"
      },
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": [
        "all",
        [
          "==",
          "brunnel",
          "bridge"
        ],
        [
          "==",
          "class",
          "motorway"
        ]
      ],
      "layout": {
        "line-join": "round"
      },
      "paint": {
        "line-color": "#e9ac77",
        "line-width": {
          "base": 1.2,
          "stops": [
            [
              5,
              0.4
            ],
            [
              6,
              0.6
            ],
            [
              7,
              1.5
            ],
            [
              20,
              22
            ]
          ]
        },
        "line-opacity": 0.5
      }
    },
    {
      "id": "bridge-path-casing",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849334699.1902"
      },
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": [
        "all",
        [
          "==",
          "$type",
          "LineString"
        ],
        [
          "all",
          [
            "==",
            "brunnel",
            "bridge"
          ],
          [
            "==",
            "class",
            "path"
          ]
        ]
      ],
      "paint": {
        "line-color": "#f8f4f0",
        "line-width": {
          "base": 1.2,
          "stops": [
            [
              15,
              1.2
            ],
            [
              20,
              18
            ]
          ]
        }
      }
    },
    {
      "id": "bridge-path",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849334699.1902"
      },
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": [
        "all",
        [
          "==",
          "$type",
          "LineString"
        ],
        [
          "all",
          [
            "==",
            "brunnel",
            "bridge"
          ],
          [
            "==",
            "class",
            "path"
          ]
        ]
      ],
      "paint": {
        "line-color": "#cba",
        "line-width": {
          "base": 1.2,
          "stops": [
            [
              15,
              1.2
            ],
            [
              20,
              4
            ]
          ]
        },
        "line-dasharray": [
          1.5,
          0.75
        ]
      }
    },
    {
      "id": "bridge-motorway-link",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849334699.1902"
      },
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": [
        "all",
        [
          "==",
          "brunnel",
          "bridge"
        ],
        [
          "==",
          "class",
          "motorway_link"
        ]
      ],
      "layout": {
        "line-join": "round"
      },
      "paint": {
        "line-color": "#fc8",
        "line-width": {
          "base": 1.2,
          "stops": [
            [
              12.5,
              0
            ],
            [
              13,
              1.5
            ],
            [
              14,
              2.5
            ],
            [
              20,
              11.5
            ]
          ]
        }
      }
    },
    {
      "id": "bridge-link",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849334699.1902"
      },
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": [
        "all",
        [
          "==",
          "brunnel",
          "bridge"
        ],
        [
          "in",
          "class",
          "primary_link",
          "secondary_link",
          "tertiary_link",
          "trunk_link"
        ]
      ],
      "layout": {
        "line-join": "round"
      },
      "paint": {
        "line-color": "#fea",
        "line-width": {
          "base": 1.2,
          "stops": [
            [
              12.5,
              0
            ],
            [
              13,
              1.5
            ],
            [
              14,
              2.5
            ],
            [
              20,
              11.5
            ]
          ]
        }
      }
    },
    {
      "id": "bridge-secondary-tertiary",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849334699.1902"
      },
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": [
        "all",
        [
          "==",
          "brunnel",
          "bridge"
        ],
        [
          "in",
          "class",
          "secondary",
          "tertiary"
        ]
      ],
      "layout": {
        "line-join": "round"
      },
      "paint": {
        "line-color": "#fea",
        "line-width": {
          "base": 1.2,
          "stops": [
            [
              6.5,
              0
            ],
            [
              7,
              0.5
            ],
            [
              20,
              20
            ]
          ]
        }
      }
    },
    {
      "id": "bridge-trunk-primary",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849334699.1902"
      },
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": [
        "all",
        [
          "==",
          "brunnel",
          "bridge"
        ],
        [
          "in",
          "class",
          "primary",
          "trunk"
        ]
      ],
      "layout": {
        "line-join": "round"
      },
      "paint": {
        "line-color": "#fea",
        "line-width": {
          "base": 1.2,
          "stops": [
            [
              6.5,
              0
            ],
            [
              7,
              0.5
            ],
            [
              20,
              18
            ]
          ]
        }
      }
    },
    {
      "id": "bridge-motorway",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849334699.1902"
      },
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": [
        "all",
        [
          "==",
          "brunnel",
          "bridge"
        ],
        [
          "==",
          "class",
          "motorway"
        ]
      ],
      "layout": {
        "line-join": "round"
      },
      "paint": {
        "line-color": "#fc8",
        "line-width": {
          "base": 1.2,
          "stops": [
            [
              6.5,
              0
            ],
            [
              7,
              0.5
            ],
            [
              20,
              18
            ]
          ]
        },
        "line-opacity": 0.5
      }
    },
    {
      "id": "bridge-railway",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849334699.1902"
      },
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": [
        "all",
        [
          "==",
          "brunnel",
          "bridge"
        ],
        [
          "==",
          "class",
          "rail"
        ]
      ],
      "paint": {
        "line-color": "#bbb",
        "line-width": {
          "base": 1.4,
          "stops": [
            [
              14,
              0.4
            ],
            [
              15,
              0.75
            ],
            [
              20,
              2
            ]
          ]
        }
      }
    },
    {
      "id": "bridge-railway-hatching",
      "type": "line",
      "metadata": {
        "mapbox:group": "1444849334699.1902"
      },
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": [
        "all",
        [
          "==",
          "brunnel",
          "bridge"
        ],
        [
          "==",
          "class",
          "rail"
        ]
      ],
      "paint": {
        "line-color": "#bbb",
        "line-dasharray": [
          0.2,
          8
        ],
        "line-width": {
          "base": 1.4,
          "stops": [
            [
              14.5,
              0
            ],
            [
              15,
              3
            ],
            [
              20,
              8
            ]
          ]
        }
      }
    },
    {
      "id": "cablecar",
      "type": "line",
      "source": "openmaptiles",
      "source-layer": "transportation",
      "minzoom": 13,
      "filter": [
        "==",
        "class",
        "cable_car"
      ],
      "layout": {
        "visibility": "visible",
        "line-cap": "round"
      },
      "paint": {
        "line-color": "hsl(0, 0%, 70%)",
        "line-width": {
          "base": 1,
          "stops": [
            [
              11,
              1
            ],
            [
              19,
              2.5
            ]
          ]
        }
      }
    },
    {
      "id": "cablecar-dash",
      "type": "line",
      "source": "openmaptiles",
      "source-layer": "transportation",
      "minzoom": 13,
      "filter": [
        "==",
        "class",
        "cable_car"
      ],
      "layout": {
        "visibility": "visible",
        "line-cap": "round"
      },
      "paint": {
        "line-color": "hsl(0, 0%, 70%)",
        "line-width": {
          "base": 1,
          "stops": [
            [
              11,
              3
            ],
            [
              19,
              5.5
            ]
          ]
        },
        "line-dasharray": [
          2,
          3
        ]
      }
    },
    {
      "id": "boundary-land-level-4",
      "type": "line",
      "source": "openmaptiles",
      "source-layer": "boundary",
      "filter": [
        "all",
        [
          ">=",
          "admin_level",
          4
        ],
        [
          "<=",
          "admin_level",
          8
        ],
        [
          "!=",
          "maritime",
          1
        ]
      ],
      "layout": {
        "line-join": "round"
      },
      "paint": {
        "line-color": "#9e9cab",
        "line-dasharray": [
          3,
          1,
          1,
          1
        ],
        "line-width": {
          "base": 1.4,
          "stops": [
            [
              4,
              0.4
            ],
            [
              5,
              1
            ],
            [
              12,
              3
            ]
          ]
        },
        "line-opacity": 0.6
      }
    },
    {
      "id": "boundary-land-level-2",
      "type": "line",
      "source": "openmaptiles",
      "source-layer": "boundary",
      "filter": [
        "all",
        [
          "==",
          "admin_level",
          2
        ],
        [
          "!=",
          "maritime",
          1
        ],
        [
          "!=",
          "disputed",
          1
        ]
      ],
      "layout": {
        "line-cap": "round",
        "line-join": "round"
      },
      "paint": {
        "line-color": "hsl(248, 7%, 66%)",
        "line-width": {
          "base": 1,
          "stops": [
            [
              0,
              0.6
            ],
            [
              4,
              1.4
            ],
            [
              5,
              2
            ],
            [
              12,
              2
            ]
          ]
        }
      }
    },
    {
      "id": "boundary-land-disputed",
      "type": "line",
      "source": "openmaptiles",
      "source-layer": "boundary",
      "filter": [
        "all",
        [
          "!=",
          "maritime",
          1
        ],
        [
          "==",
          "disputed",
          1
        ]
      ],
      "layout": {
        "line-cap": "round",
        "line-join": "round"
      },
      "paint": {
        "line-color": "hsl(248, 7%, 70%)",
        "line-dasharray": [
          1,
          3
        ],
        "line-width": {
          "base": 1,
          "stops": [
            [
              0,
              0.6
            ],
            [
              4,
              1.4
            ],
            [
              5,
              2
            ],
            [
              12,
              8
            ]
          ]
        }
      }
    },
    {
      "id": "boundary-water",
      "type": "line",
      "source": "openmaptiles",
      "source-layer": "boundary",
      "filter": [
        "all",
        [
          "in",
          "admin_level",
          2,
          4
        ],
        [
          "==",
          "maritime",
          1
        ]
      ],
      "layout": {
        "line-cap": "round",
        "line-join": "round"
      },
      "paint": {
        "line-color": "rgba(154, 189, 214, 1)",
        "line-width": {
          "base": 1,
          "stops": [
            [
              0,
              0.6
            ],
            [
              4,
              1
            ],
            [
              5,
              1
            ],
            [
              12,
              1
            ]
          ]
        },
        "line-opacity": {
          "stops": [
            [
              6,
              0
            ],
            [
              10,
              0
            ]
          ]
        }
      }
    },
    {
      "id": "waterway-name",
      "type": "symbol",
      "source": "openmaptiles",
      "source-layer": "waterway",
      "minzoom": 13,
      "filter": [
        "all",
        [
          "==",
          "$type",
          "LineString"
        ],
        [
          "has",
          "name"
        ]
      ],
      "layout": {
        "text-font": [
          "Noto Sans Italic"
        ],
        "text-size": 14,
        "text-field": "{name:latin} {name:nonlatin}",
        "text-max-width": 5,
        "text-rotation-alignment": "map",
        "symbol-placement": "line",
        "text-letter-spacing": 0.2,
        "symbol-spacing": 350
      },
      "paint": {
        "text-color": "#74aee9",
        "text-halo-width": 1.5,
        "text-halo-color": "rgba(255,255,255,0.7)"
      }
    },
    {
      "id": "water-name-lakeline",
      "type": "symbol",
      "source": "openmaptiles",
      "source-layer": "water_name",
      "filter": [
        "==",
        "$type",
        "LineString"
      ],
      "layout": {
        "text-font": [
          "Noto Sans Italic"
        ],
        "text-size": 14,
        "text-field": "{name:latin}\n{name:nonlatin}",
        "text-max-width": 5,
        "text-rotation-alignment": "map",
        "symbol-placement": "line",
        "symbol-spacing": 350,
        "text-letter-spacing": 0.2
      },
      "paint": {
        "text-color": "#74aee9",
        "text-halo-width": 1.5,
        "text-halo-color": "rgba(255,255,255,0.7)"
      }
    },
    {
      "id": "water-name-ocean",
      "type": "symbol",
      "source": "openmaptiles",
      "source-layer": "water_name",
      "filter": [
        "all",
        [
          "==",
          "$type",
          "Point"
        ],
        [
          "==",
          "class",
          "ocean"
        ]
      ],
      "layout": {
        "text-font": [
          "Noto Sans Italic"
        ],
        "text-size": 14,
        "text-field": "{name:latin}",
        "text-max-width": 5,
        "text-rotation-alignment": "map",
        "symbol-placement": "point",
        "symbol-spacing": 350,
        "text-letter-spacing": 0.2
      },
      "paint": {
        "text-color": "#74aee9",
        "text-halo-width": 1.5,
        "text-halo-color": "rgba(255,255,255,0.7)"
      }
    },
    {
      "id": "water-name-other",
      "type": "symbol",
      "source": "openmaptiles",
      "source-layer": "water_name",
      "filter": [
        "all",
        [
          "==",
          "$type",
          "Point"
        ],
        [
          "!in",
          "class",
          "ocean"
        ]
      ],
      "layout": {
        "text-font": [
          "Noto Sans Italic"
        ],
        "text-size": {
          "stops": [
            [
              0,
              10
            ],
            [
              6,
              14
            ]
          ]
        },
        "text-field": "{name:latin}\n{name:nonlatin}",
        "text-max-width": 5,
        "text-rotation-alignment": "map",
        "symbol-placement": "point",
        "symbol-spacing": 350,
        "text-letter-spacing": 0.2,
        "visibility": "visible"
      },
      "paint": {
        "text-color": "#74aee9",
        "text-halo-width": 1.5,
        "text-halo-color": "rgba(255,255,255,0.7)"
      }
    },
    {
      "id": "poi-level-3",
      "type": "symbol",
      "source": "openmaptiles",
      "source-layer": "poi",
      "minzoom": 16,
      "filter": [
        "all",
        [
          "==",
          "$type",
          "Point"
        ],
        [
          ">=",
          "rank",
          25
        ]
      ],
      "layout": {
        "text-padding": 2,
        "text-font": [
          "Noto Sans Regular"
        ],
        "text-anchor": "top",
        "icon-image": "{class}_11",
        "text-field": "{name:latin}\n{name:nonlatin}",
        "text-offset": [
          0,
          0.6
        ],
        "text-size": 12,
        "text-max-width": 9
      },
      "paint": {
        "text-halo-blur": 0.5,
        "text-color": "#666",
        "text-halo-width": 1,
        "text-halo-color": "#ffffff"
      }
    },
    {
      "id": "poi-level-2",
      "type": "symbol",
      "source": "openmaptiles",
      "source-layer": "poi",
      "minzoom": 15,
      "filter": [
        "all",
        [
          "==",
          "$type",
          "Point"
        ],
        [
          "<=",
          "rank",
          24
        ],
        [
          ">=",
          "rank",
          15
        ]
      ],
      "layout": {
        "text-padding": 2,
        "text-font": [
          "Noto Sans Regular"
        ],
        "text-anchor": "top",
        "icon-image": "{class}_11",
        "text-field": "{name:latin}\n{name:nonlatin}",
        "text-offset": [
          0,
          0.6
        ],
        "text-size": 12,
        "text-max-width": 9
      },
      "paint": {
        "text-halo-blur": 0.5,
        "text-color": "#666",
        "text-halo-width": 1,
        "text-halo-color": "#ffffff"
      }
    },
    {
      "id": "poi-level-1",
      "type": "symbol",
      "source": "openmaptiles",
      "source-layer": "poi",
      "minzoom": 14,
      "filter": [
        "all",
        [
          "==",
          "$type",
          "Point"
        ],
        [
          "<=",
          "rank",
          14
        ],
        [
          "has",
          "name"
        ]
      ],
      "layout": {
        "text-padding": 2,
        "text-font": [
          "Noto Sans Regular"
        ],
        "text-anchor": "top",
        "icon-image": "{class}_11",
        "text-field": "{name:latin}\n{name:nonlatin}",
        "text-offset": [
          0,
          0.6
        ],
        "text-size": 11,
        "text-max-width": 9
      },
      "paint": {
        "text-halo-blur": 0.5,
        "text-color": "rgba(191, 228, 172, 1)",
        "text-halo-width": 1,
        "text-halo-color": "rgba(30, 29, 29, 1)"
      }
    },
    {
      "id": "poi-railway",
      "type": "symbol",
      "source": "openmaptiles",
      "source-layer": "poi",
      "minzoom": 13,
      "filter": [
        "all",
        [
          "==",
          "$type",
          "Point"
        ],
        [
          "has",
          "name"
        ],
        [
          "==",
          "class",
          "railway"
        ],
        [
          "==",
          "subclass",
          "station"
        ]
      ],
      "layout": {
        "text-padding": 2,
        "text-font": [
          "Noto Sans Regular"
        ],
        "text-anchor": "top",
        "icon-image": "{class}_11",
        "text-field": "{name:latin}\n{name:nonlatin}",
        "text-offset": [
          0,
          0.6
        ],
        "text-size": 12,
        "text-max-width": 9,
        "icon-optional": false,
        "icon-ignore-placement": false,
        "icon-allow-overlap": false,
        "text-ignore-placement": false,
        "text-allow-overlap": false,
        "text-optional": true
      },
      "paint": {
        "text-halo-blur": 0.5,
        "text-color": "#666",
        "text-halo-width": 1,
        "text-halo-color": "#ffffff"
      }
    },
    {
      "id": "road_oneway",
      "type": "symbol",
      "source": "openmaptiles",
      "source-layer": "transportation",
      "minzoom": 15,
      "filter": [
        "all",
        [
          "==",
          "oneway",
          1
        ],
        [
          "in",
          "class",
          "motorway",
          "trunk",
          "primary",
          "secondary",
          "tertiary",
          "minor",
          "service"
        ]
      ],
      "layout": {
        "symbol-placement": "line",
        "icon-image": "oneway",
        "symbol-spacing": 75,
        "icon-padding": 2,
        "icon-rotation-alignment": "map",
        "icon-rotate": 90,
        "icon-size": {
          "stops": [
            [
              15,
              0.5
            ],
            [
              19,
              1
            ]
          ]
        }
      },
      "paint": {
        "icon-opacity": 0.5
      }
    },
    {
      "id": "road_oneway_opposite",
      "type": "symbol",
      "source": "openmaptiles",
      "source-layer": "transportation",
      "minzoom": 15,
      "filter": [
        "all",
        [
          "==",
          "oneway",
          -1
        ],
        [
          "in",
          "class",
          "motorway",
          "trunk",
          "primary",
          "secondary",
          "tertiary",
          "minor",
          "service"
        ]
      ],
      "layout": {
        "symbol-placement": "line",
        "icon-image": "oneway",
        "symbol-spacing": 75,
        "icon-padding": 2,
        "icon-rotation-alignment": "map",
        "icon-rotate": -90,
        "icon-size": {
          "stops": [
            [
              15,
              0.5
            ],
            [
              19,
              1
            ]
          ]
        }
      },
      "paint": {
        "icon-opacity": 0.5
      }
    },
    {
      "id": "highway-name-path",
      "type": "symbol",
      "source": "openmaptiles",
      "source-layer": "transportation_name",
      "minzoom": 15.5,
      "filter": [
        "==",
        "class",
        "path"
      ],
      "layout": {
        "text-size": {
          "base": 1,
          "stops": [
            [
              13,
              12
            ],
            [
              14,
              13
            ]
          ]
        },
        "text-font": [
          "Noto Sans Regular"
        ],
        "text-field": "{name:latin} {name:nonlatin}",
        "symbol-placement": "line",
        "text-rotation-alignment": "map"
      },
      "paint": {
        "text-halo-color": "#f8f4f0",
        "text-color": "hsl(30, 23%, 62%)",
        "text-halo-width": 0.5
      }
    },
    {
      "id": "highway-name-minor",
      "type": "symbol",
      "source": "openmaptiles",
      "source-layer": "transportation_name",
      "minzoom": 15,
      "filter": [
        "all",
        [
          "==",
          "$type",
          "LineString"
        ],
        [
          "in",
          "class",
          "minor",
          "service",
          "track"
        ]
      ],
      "layout": {
        "text-size": {
          "base": 1,
          "stops": [
            [
              13,
              12
            ],
            [
              14,
              13
            ]
          ]
        },
        "text-font": [
          "Noto Sans Regular"
        ],
        "text-field": "{name:latin} {name:nonlatin}",
        "symbol-placement": "line",
        "text-rotation-alignment": "map"
      },
      "paint": {
        "text-halo-blur": 0.5,
        "text-color": "#765",
        "text-halo-width": 1
      }
    },
    {
      "id": "highway-name-major",
      "type": "symbol",
      "source": "openmaptiles",
      "source-layer": "transportation_name",
      "minzoom": 12.2,
      "filter": [
        "in",
        "class",
        "primary",
        "secondary",
        "tertiary",
        "trunk"
      ],
      "layout": {
        "text-size": {
          "base": 1,
          "stops": [
            [
              13,
              12
            ],
            [
              14,
              13
            ]
          ]
        },
        "text-font": [
          "Noto Sans Regular"
        ],
        "text-field": "{name:latin} {name:nonlatin}",
        "symbol-placement": "line",
        "text-rotation-alignment": "map"
      },
      "paint": {
        "text-halo-blur": 0.5,
        "text-color": "#765",
        "text-halo-width": 1
      }
    },
    {
      "id": "highway-shield",
      "type": "symbol",
      "source": "openmaptiles",
      "source-layer": "transportation_name",
      "minzoom": 8,
      "filter": [
        "all",
        [
          "<=",
          "ref_length",
          6
        ],
        [
          "==",
          "$type",
          "LineString"
        ],
        [
          "!in",
          "network",
          "us-interstate",
          "us-highway",
          "us-state"
        ]
      ],
      "layout": {
        "text-size": 10,
        "icon-image": "road_{ref_length}",
        "icon-rotation-alignment": "viewport",
        "symbol-spacing": 200,
        "text-font": [
          "Noto Sans Regular"
        ],
        "symbol-placement": {
          "base": 1,
          "stops": [
            [
              10,
              "point"
            ],
            [
              11,
              "line"
            ]
          ]
        },
        "text-rotation-alignment": "viewport",
        "icon-size": 1,
        "text-field": "{ref}"
      },
      "paint": {
        "text-opacity": 1,
        "text-color": "rgba(20, 19, 19, 1)",
        "text-halo-color": "rgba(230, 221, 221, 0)",
        "text-halo-width": 2,
        "icon-color": "rgba(183, 18, 18, 1)",
        "icon-opacity": 0.3,
        "icon-halo-color": "rgba(183, 55, 55, 0)"
      }
    },
    {
      "id": "highway-shield-us-interstate",
      "type": "symbol",
      "source": "openmaptiles",
      "source-layer": "transportation_name",
      "minzoom": 7,
      "filter": [
        "all",
        [
          "<=",
          "ref_length",
          6
        ],
        [
          "==",
          "$type",
          "LineString"
        ],
        [
          "in",
          "network",
          "us-interstate"
        ]
      ],
      "layout": {
        "text-size": 10,
        "icon-image": "{network}_{ref_length}",
        "icon-rotation-alignment": "viewport",
        "symbol-spacing": 200,
        "text-font": [
          "Noto Sans Regular"
        ],
        "symbol-placement": {
          "base": 1,
          "stops": [
            [
              7,
              "point"
            ],
            [
              7,
              "line"
            ],
            [
              8,
              "line"
            ]
          ]
        },
        "text-rotation-alignment": "viewport",
        "icon-size": 1,
        "text-field": "{ref}"
      },
      "paint": {
        "text-color": "rgba(0, 0, 0, 1)"
      }
    },
    {
      "id": "highway-shield-us-other",
      "type": "symbol",
      "source": "openmaptiles",
      "source-layer": "transportation_name",
      "minzoom": 9,
      "filter": [
        "all",
        [
          "<=",
          "ref_length",
          6
        ],
        [
          "==",
          "$type",
          "LineString"
        ],
        [
          "in",
          "network",
          "us-highway",
          "us-state"
        ]
      ],
      "layout": {
        "text-size": 10,
        "icon-image": "{network}_{ref_length}",
        "icon-rotation-alignment": "viewport",
        "symbol-spacing": 200,
        "text-font": [
          "Noto Sans Regular"
        ],
        "symbol-placement": {
          "base": 1,
          "stops": [
            [
              10,
              "point"
            ],
            [
              11,
              "line"
            ]
          ]
        },
        "text-rotation-alignment": "viewport",
        "icon-size": 1,
        "text-field": "{ref}"
      },
      "paint": {
        "text-color": "rgba(0, 0, 0, 1)"
      }
    },
    {
      "id": "place-other",
      "type": "symbol",
      "metadata": {
        "mapbox:group": "1444849242106.713"
      },
      "source": "openmaptiles",
      "source-layer": "place",
      "minzoom": 12,
      "filter": [
        "!in",
        "class",
        "city",
        "town",
        "village",
        "country",
        "continent"
      ],
      "layout": {
        "text-letter-spacing": 0.1,
        "text-size": {
          "base": 1.2,
          "stops": [
            [
              12,
              10
            ],
            [
              15,
              14
            ]
          ]
        },
        "text-font": [
          "Noto Sans Bold"
        ],
        "text-field": "{name:latin}\n{name:nonlatin}",
        "text-transform": "uppercase",
        "text-max-width": 9,
        "visibility": "visible"
      },
      "paint": {
        "text-color": "rgba(255,255,255,1)",
        "text-halo-width": 1.2,
        "text-halo-color": "rgba(57, 28, 28, 1)"
      }
    },
    {
      "id": "place-village",
      "type": "symbol",
      "metadata": {
        "mapbox:group": "1444849242106.713"
      },
      "source": "openmaptiles",
      "source-layer": "place",
      "minzoom": 10,
      "filter": [
        "==",
        "class",
        "village"
      ],
      "layout": {
        "text-font": [
          "Noto Sans Regular"
        ],
        "text-size": {
          "base": 1.2,
          "stops": [
            [
              10,
              12
            ],
            [
              15,
              16
            ]
          ]
        },
        "text-field": "{name:latin}\n{name:nonlatin}",
        "text-max-width": 8,
        "visibility": "visible"
      },
      "paint": {
        "text-color": "rgba(255, 255, 255, 1)",
        "text-halo-width": 1.2,
        "text-halo-color": "rgba(10, 9, 9, 0.8)"
      }
    },
    {
      "id": "place-town",
      "type": "symbol",
      "metadata": {
        "mapbox:group": "1444849242106.713"
      },
      "source": "openmaptiles",
      "source-layer": "place",
      "filter": [
        "==",
        "class",
        "town"
      ],
      "layout": {
        "text-font": [
          "Noto Sans Regular"
        ],
        "text-size": {
          "base": 1.2,
          "stops": [
            [
              10,
              14
            ],
            [
              15,
              24
            ]
          ]
        },
        "text-field": "{name:latin}\n{name:nonlatin}",
        "text-max-width": 8,
        "visibility": "visible"
      },
      "paint": {
        "text-color": "rgba(255, 255, 255, 1)",
        "text-halo-width": 1.2,
        "text-halo-color": "rgba(22, 22, 22, 0.8)"
      }
    },
    {
      "id": "place-city",
      "type": "symbol",
      "metadata": {
        "mapbox:group": "1444849242106.713"
      },
      "source": "openmaptiles",
      "source-layer": "place",
      "filter": [
        "all",
        [
          "!=",
          "capital",
          2
        ],
        [
          "==",
          "class",
          "city"
        ]
      ],
      "layout": {
        "text-font": [
          "Noto Sans Regular"
        ],
        "text-size": {
          "base": 1.2,
          "stops": [
            [
              7,
              14
            ],
            [
              11,
              24
            ]
          ]
        },
        "text-field": "{name:latin}\n{name:nonlatin}",
        "text-max-width": 8,
        "visibility": "visible"
      },
      "paint": {
        "text-color": "rgba(0, 0, 0, 1)",
        "text-halo-width": 1.2,
        "text-halo-color": "rgba(255,255,255,0.8)"
      }
    },
    {
      "id": "place-city-capital",
      "type": "symbol",
      "metadata": {
        "mapbox:group": "1444849242106.713"
      },
      "source": "openmaptiles",
      "source-layer": "place",
      "filter": [
        "all",
        [
          "==",
          "capital",
          2
        ],
        [
          "==",
          "class",
          "city"
        ]
      ],
      "layout": {
        "text-font": [
          "Noto Sans Regular"
        ],
        "text-size": {
          "base": 1.2,
          "stops": [
            [
              7,
              14
            ],
            [
              11,
              24
            ]
          ]
        },
        "text-field": "{name:latin}\n{name:nonlatin}",
        "text-max-width": 8,
        "icon-image": "star_11",
        "text-offset": [
          0.4,
          0
        ],
        "icon-size": 0.8,
        "text-anchor": "left",
        "visibility": "visible"
      },
      "paint": {
        "text-color": "#333",
        "text-halo-width": 1.2,
        "text-halo-color": "rgba(255,255,255,0.8)"
      }
    },
    {
      "id": "place-country-other",
      "type": "symbol",
      "metadata": {
        "mapbox:group": "1444849242106.713"
      },
      "source": "openmaptiles",
      "source-layer": "place",
      "filter": [
        "all",
        [
          "==",
          "class",
          "country"
        ],
        [
          ">=",
          "rank",
          3
        ],
        [
          "!has",
          "iso_a2"
        ]
      ],
      "layout": {
        "text-font": [
          "Noto Sans Italic"
        ],
        "text-field": "{name:latin}",
        "text-size": {
          "stops": [
            [
              3,
              11
            ],
            [
              7,
              17
            ]
          ]
        },
        "text-transform": "uppercase",
        "text-max-width": 6.25,
        "visibility": "visible"
      },
      "paint": {
        "text-halo-blur": 1,
        "text-color": "#334",
        "text-halo-width": 2,
        "text-halo-color": "rgba(255,255,255,0.8)"
      }
    },
    {
      "id": "place-country-3",
      "type": "symbol",
      "metadata": {
        "mapbox:group": "1444849242106.713"
      },
      "source": "openmaptiles",
      "source-layer": "place",
      "filter": [
        "all",
        [
          "==",
          "class",
          "country"
        ],
        [
          ">=",
          "rank",
          3
        ],
        [
          "has",
          "iso_a2"
        ]
      ],
      "layout": {
        "text-font": [
          "Noto Sans Bold"
        ],
        "text-field": "{name:latin}",
        "text-size": {
          "stops": [
            [
              3,
              11
            ],
            [
              7,
              17
            ]
          ]
        },
        "text-transform": "uppercase",
        "text-max-width": 6.25,
        "visibility": "visible"
      },
      "paint": {
        "text-halo-blur": 1,
        "text-color": "#334",
        "text-halo-width": 2,
        "text-halo-color": "rgba(255,255,255,0.8)"
      }
    },
    {
      "id": "place-country-2",
      "type": "symbol",
      "metadata": {
        "mapbox:group": "1444849242106.713"
      },
      "source": "openmaptiles",
      "source-layer": "place",
      "filter": [
        "all",
        [
          "==",
          "class",
          "country"
        ],
        [
          "==",
          "rank",
          2
        ],
        [
          "has",
          "iso_a2"
        ]
      ],
      "layout": {
        "text-font": [
          "Noto Sans Bold"
        ],
        "text-field": "{name:latin}",
        "text-size": {
          "stops": [
            [
              2,
              11
            ],
            [
              5,
              17
            ]
          ]
        },
        "text-transform": "uppercase",
        "text-max-width": 6.25,
        "visibility": "visible"
      },
      "paint": {
        "text-halo-blur": 1,
        "text-color": "#334",
        "text-halo-width": 2,
        "text-halo-color": "rgba(255,255,255,0.8)"
      }
    },
    {
      "id": "place-country-1",
      "type": "symbol",
      "metadata": {
        "mapbox:group": "1444849242106.713"
      },
      "source": "openmaptiles",
      "source-layer": "place",
      "filter": [
        "all",
        [
          "==",
          "class",
          "country"
        ],
        [
          "==",
          "rank",
          1
        ],
        [
          "has",
          "iso_a2"
        ]
      ],
      "layout": {
        "text-font": [
          "Noto Sans Bold"
        ],
        "text-field": "{name:latin}",
        "text-size": {
          "stops": [
            [
              1,
              11
            ],
            [
              4,
              17
            ]
          ]
        },
        "text-transform": "uppercase",
        "text-max-width": 6.25,
        "visibility": "visible"
      },
      "paint": {
        "text-halo-blur": 1,
        "text-color": "#334",
        "text-halo-width": 2,
        "text-halo-color": "rgba(255,255,255,0.8)"
      }
    },
    {
      "id": "place-continent",
      "type": "symbol",
      "metadata": {
        "mapbox:group": "1444849242106.713"
      },
      "source": "openmaptiles",
      "source-layer": "place",
      "maxzoom": 1,
      "filter": [
        "==",
        "class",
        "continent"
      ],
      "layout": {
        "text-font": [
          "Noto Sans Bold"
        ],
        "text-field": "{name:latin}",
        "text-size": 14,
        "text-max-width": 6.25,
        "text-transform": "uppercase",
        "visibility": "visible"
      },
      "paint": {
        "text-halo-blur": 1,
        "text-color": "#334",
        "text-halo-width": 2,
        "text-halo-color": "rgba(255,255,255,0.8)"
      }
    }
  ],
  "id": "qebnlkra6"
})



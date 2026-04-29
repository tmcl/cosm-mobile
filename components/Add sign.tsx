import React, { useState } from "react";
import { Text, View, ViewProps } from "react-native";
import * as RNE from "@rneui/themed";

const VStack = ({ children, ...props }: React.PropsWithChildren<ViewProps>) => (
  <View
    {...props}
    style={Object.assign(props.style || {}, { flexDirection: "column" })}
  >
    {children}
  </View>
);

const HStack = ({ children, ...props }: React.PropsWithChildren<ViewProps>) => (
  <View
    {...props}
    style={Object.assign(props.style || {}, {
      width: "100%",
      flexDirection: "row",
    })}
  >
    {children}
  </View>
);

export const signTypeIcon: Record<SignType, RNE.IconProps> = {
  "maxspeed,city_limit maxspeed=?? name=?! city_limit=begin": {
    name: "rectangle",
    color: "green",
  },
  "maxspeed maxspeed=?!": { name: "circle", type: "octicon", color: "red" },
  stop: { name: "octagon", color: "red", type: "material-community" },
  give_way: {
    name: "triangle-outline",
    style: { transform: [{ rotate: "180deg" }] },
    color: "red",
    type: "material-community",
  },
  "give_way,roundabout": { name: "arrows-spin", type: "font-awesome-6" },
  "stop_ahead distance=??": {
    name: "octagon",
    color: "black",
    type: "material-community",
  },
  "yield_ahead distance=??": {
    name: "triangle-outline",
    style: { transform: [{ rotate: "180deg" }] },
    color: "black",
    type: "material-community",
  },
  "signal_ahead distance=??": { name: "traffic-light", type: "font-awesome-5" },
  "hazard hazard=?!": {
    name: "diamond",
    color: "orange",
    type: "font-awesome-6",
  },
};

export const signTypes = {
  "maxspeed,city_limit maxspeed=?? name=?! city_limit=begin": "City Limit",
  "maxspeed maxspeed=?!": "Speed Limit",
  stop: "Stop",
  give_way: "Give Way",
  "give_way,roundabout": "Roundabout",
  "stop_ahead distance=??": "Stop Ahead",
  "yield_ahead distance=??": "Give Way Ahead",
  "signal_ahead distance=??": "Traffic Lights Ahead",
  "hazard hazard=?!": "Warning",
};

export type SignType = keyof typeof signTypes;

export const hazardTypes = {
  "animal_crossing hazard:animal=??": "Animal Crossing",
  bump: "Speed Hump",
  children: "Children",
  "curve curve:direction=??": "Curve",
  "curve curve=hairpin curve:direction=??": "Hairpin curve",
  "curve curve=loop curve:direction=??": "Loop",
  "curves curves=serpentine curve:direction=??": "Serpentive/Double Curve",
  "curves curves=extended curve:direction=??": "Extended curves/Windy road",
  cyclists: "Cyclists",
  "crossroad priority=with_us": "Crossroads",
  "sideroad priority=with_us sideroad:direction=?": "Side road",
  "crossroad priority=with_us staggered:direction=?":
    "Staggered crossroad road",
};

type HazardType = keyof typeof hazardTypes;

const isValidHazardType = (hazardType: string): hazardType is HazardType => {
  return !!(hazardTypes as any)[hazardType];
};

const speedUnits = {
  "km/h": "km/h",
  mph: "mph",
};

type SpeedUnit = keyof typeof speedUnits;

const isValidSpeedUnit = (speedUnit: string): speedUnit is SpeedUnit => {
  return !!(speedUnits as any)[speedUnit];
};

type UnitChooserSettings<T extends string, IsOptional extends boolean> = {
  placeholder: string;
  optional: IsOptional;
  options: { [property in T]: string };
  pureNumber: boolean;
  stringIsValidUnit: (str: string) => str is T;
};

type UnitChooserProps<
  Unit extends string,
  IsOptional extends boolean,
  ParsedMeasure extends string,
> = UnitProps<Unit, IsOptional, ParsedMeasure> &
  UnitChooserSettings<Unit, IsOptional>;

function UnitChooser<
  Unit extends string,
  IsOptional extends boolean,
  ParsedMeasure extends string,
>(params: UnitChooserProps<Unit, IsOptional, ParsedMeasure>) {
  const keys = Object.keys(params.options);
  const buttons: string[] = [];
  keys.forEach(
    (k) => params.stringIsValidUnit(k) && buttons.push(params.options[k]),
  );
  const selButton = keys.findIndex((k) => k === params.unit);
  const logger = (args: number) =>
    params.stringIsValidUnit(keys[args]) && params.onChooseUnit(keys[args]);
  return (
    <HStack style={{ width: "100%" }}>
      <View style={{ width: "60%", borderWidth: 1, borderColor: "teal" }}>
        <RNE.Input
          errorMessage={
            params.isValid &&
            (params.optional || !(typeof params.parsedValue === "string"))
              ? undefined
              : "Enter a number"
          }
          onChangeText={params.onUpdateRawValue}
          value={params.rawValue}
          keyboardType={params.pureNumber ? "number-pad" : undefined}
          placeholder={params.placeholder}
        />
      </View>
      <View style={{ width: "30%", borderWidth: 1, borderColor: "orange" }}>
        <RNE.ButtonGroup
          onPress={logger}
          selectedIndex={selButton}
          buttons={buttons}
        />
      </View>
    </HStack>
  );
}

const distanceUnits = {
  m: "m",
  km: "km",
  ft: "ft'in",
  yd: "yd",
  mi: "miles",
};

type DistanceUnit = keyof typeof distanceUnits;

const isValidDistanceUnit = (
  distanceUnit: string,
): distanceUnit is DistanceUnit => {
  return !!(distanceUnits as any)[distanceUnit];
};

const isFloat = /^[0-9]+(.[0-9]+)?$/;
const isFtIn = /^[0-9]+('([0-9]+")?)?$/;

const isValidSpeed = (input: string) => {
  return !isNaN(+input);
};

const isValidDistance = (distanceUnit: DistanceUnit, distance: string) => {
  switch (distanceUnit) {
    case "ft":
      return isFtIn.test(distance);
    default:
      return isFloat.test(distance);
  }
};

const DistanceChooser = <IsOptional extends boolean>(
  params: Omit<
    UnitChooserProps<DistanceUnit, IsOptional, QualifiedDistance>,
    "options" | "pureNumber" | "stringIsValidUnit"
  >,
) => (
  <UnitChooser
    {...params}
    options={distanceUnits}
    stringIsValidUnit={isValidDistanceUnit}
    pureNumber={params.unit !== "ft"}
  />
);
const SpeedChooser = <IsOptional extends boolean>(
  params: Omit<
    UnitChooserProps<SpeedUnit, IsOptional, QualifiedSpeed>,
    "options" | "pureNumber" | "stringIsValidUnit"
  >,
) => (
  <UnitChooser
    {...params}
    pureNumber={true}
    options={speedUnits}
    stringIsValidUnit={isValidSpeedUnit}
  />
);

type QualifiedDistance =
  | `${number}`
  | `${number} m`
  | `${number} km`
  | `${number} yd`
  | `${number} mi`
  | `${number} ft`
  | `${number} in`
  | `${number}'${number}"`
  | `${number} nmi`;
type QualifiedSpeed =
  | `${number}`
  | `${number} km/h`
  | `${number} mph`
  | `${number} kt`;

const parseSpeed = (
  signDistance: string,
  signDistanceType: SpeedUnit,
): QualifiedSpeed | { error: string } => {
  switch (signDistanceType) {
    case "km/h": {
      const kmh = +signDistance;
      if (!isNaN(kmh)) {
        return `${kmh}`;
      } else {
        return { error: "km/h were not numeric" };
      }
    }
    default: {
      const dist = +signDistance;
      if (!isNaN(dist)) {
        return `${dist} ${signDistanceType}`;
      } else {
        return { error: `${signDistanceType} was not numeric` };
      }
    }
  }
};

const parseDistance = (
  signDistance: string,
  signDistanceType: DistanceUnit,
): QualifiedDistance | { error: string } => {
  switch (signDistanceType) {
    case "ft": {
      const posFt = signDistance.indexOf("'");
      const posIn = signDistance.indexOf('"');
      if (posFt === -1 && posIn === -1) {
        //whole string taken as ft
        const ft = +signDistance;
        if (!isNaN(ft)) {
          return `${ft} ft`;
        } else {
          return { error: "feet were not numeric" };
        }
      } else if (
        posFt > 0 &&
        (posIn === -1 || posIn === signDistance.length - 1)
      ) {
        //prior to ' taken as foot, afterwards taken as in
        const ft = +signDistance.substring(0, posFt);
        const inn = +signDistance.substring(
          posFt + 1,
          posIn === -1 ? undefined : posIn,
        );
        if (!isNaN(ft) && !isNaN(inn)) {
          return `${ft}'${inn}"`;
        } else {
          return { error: "feet or inches were not numeric" };
        }
      } else {
        return { error: "invalid feet and inches" };
      }
    }
    case "m": {
      const m = +signDistance;
      if (!isNaN(m)) {
        return `${m}`;
      } else {
        return { error: "metres were not numeric" };
      }
    }
    default: {
      const dist = +signDistance;
      if (!isNaN(dist)) {
        return `${dist} ${signDistanceType}`;
      } else {
        return { error: `${signDistanceType} was not numeric` };
      }
    }
  }
};

type DistanceProps<IsOptional extends boolean> = UnitProps<
  DistanceUnit,
  IsOptional,
  QualifiedDistance
>;

type UnitProps<Unit, IsOptional extends boolean, ParsedValue extends string> = {
  isValid: boolean;
  parsedValue:
    | ParsedValue
    | { error: string }
    | (IsOptional extends true ? undefined : never);
  unit: Unit;
  rawValue: string;
  onChooseUnit: (du: Unit) => unknown;
  onUpdateRawValue: (rd: string) => unknown;
};

type StandardSignFormType = {
  hazardType: HazardType;
  onHazardType: (h: HazardType) => unknown;
  yieldAhead: DistanceProps<true>;
  stopAhead: DistanceProps<true>;
  signalsAhead: DistanceProps<true>;
  maxspeedCityLimit: { maxspeed: SpeedProps<true>; townName: TextProps };
  maxspeed: SpeedProps<false>;
};

type SpeedProps<IsOptional extends boolean> = UnitProps<
  SpeedUnit,
  IsOptional,
  QualifiedSpeed
>;

type TextProps = {
  value: string;
  onChangeText: (i: string) => unknown;
};

const YieldAheadDistanceForm = (params: StandardSignFormType) => {
  return (
    <DistanceChooser
      {...params.yieldAhead}
      placeholder="Distance to yield"
      optional={true}
    />
  );
};

const StopAheadDistanceForm = (params: StandardSignFormType) => {
  return (
    <DistanceChooser
      {...params.stopAhead}
      placeholder="Distance to stop"
      optional={true}
    />
  );
};

const SignalAheadDistanceForm = (params: StandardSignFormType) => {
  return (
    <DistanceChooser
      {...params.signalsAhead}
      placeholder="distance"
      optional={true}
    />
  );
};

const MaxspeedCitylimitForm = (params: StandardSignFormType) => {
  return (
    <VStack>
      <SpeedChooser
        {...params.maxspeedCityLimit.maxspeed}
        placeholder="Speed"
        optional={true}
      />
      <RNE.Input
        {...params.maxspeedCityLimit.townName}
        placeholder="Town Name"
      ></RNE.Input>
    </VStack>
  );
};

const Maxspeed = (params: StandardSignFormType) => {
  return (
    <SpeedChooser {...params.maxspeed} placeholder="Speed" optional={false} />
  );
};

const Stop = () => {
  return false;
};

const Hazard = (params: StandardSignFormType) => {
  const [expanded, setExpanded] = useState(false);
  const hazardTypeLabel = hazardTypes[params.hazardType];

  return (
    <RNE.ListItem.Accordion
      onPress={() => setExpanded(!expanded)}
      isExpanded={expanded}
      content={
        <RNE.ListItem.Content>
          <RNE.ListItem.Title>
            <Text>{hazardTypeLabel}</Text>
          </RNE.ListItem.Title>
        </RNE.ListItem.Content>
      }
    >
      {Object.keys(hazardTypes).map(
        (k) =>
          isValidHazardType(k) && (
            <RNE.ListItem key={k} onPress={() => params.onHazardType(k)}>
              {/*<RNE.Icon {...signTypeIcon[k]} style={{...signTypeIcon[k].style, width:33}}></RNE.Icon>*/}
              <RNE.ListItem.Content>
                <RNE.ListItem.Title>{hazardTypes[k]}</RNE.ListItem.Title>
              </RNE.ListItem.Content>
            </RNE.ListItem>
          ),
      )}
    </RNE.ListItem.Accordion>
  );
};

const GiveWay = () => {
  return false;
};

const Roundabout = () => {
  return false;
};

export function FormFor(params: { sign: SignType } & StandardSignFormType) {
  const sign: SignType = params.sign;
  console.log(sign, "the sign");
  switch (sign) {
    case "yield_ahead distance=??": {
      return <YieldAheadDistanceForm {...params} />;
    }
    case "stop_ahead distance=??": {
      return <StopAheadDistanceForm {...params} />;
    }
    case "signal_ahead distance=??": {
      return <SignalAheadDistanceForm {...params} />;
    }
    case "maxspeed,city_limit maxspeed=?? name=?! city_limit=begin": {
      return <MaxspeedCitylimitForm {...params} />;
    }
    case "maxspeed maxspeed=?!": {
      return <Maxspeed {...params} />;
    }
    case "stop": {
      return <Stop />;
    }
    case "hazard hazard=?!": {
      return <Hazard {...params} />;
    }
    case "give_way": {
      return <GiveWay />;
    }
    case "give_way,roundabout": {
      return <Roundabout />;
    }
    default:
      const c: never = sign;
      throw c;
  }
}

const useCommonSpeedState = () => {
  const [rawValue, onUpdateRawValue] = useState("");
  const [unit, onChooseUnit] = useState<SpeedUnit>("km/h");
  const isValid = isValidSpeed(rawValue);
  return { rawValue, onUpdateRawValue, isValid, unit, onChooseUnit };
};

export const useOptionalSpeedState = (): SpeedProps<true> => {
  const state = useCommonSpeedState();
  const parsedValue =
    state.rawValue !== "" ? parseSpeed(state.rawValue, state.unit) : undefined;
  return { ...state, parsedValue };
};

export const useMandatorySpeedState = (): SpeedProps<false> => {
  const state = useCommonSpeedState();
  const parsedValue = parseSpeed(state.rawValue, state.unit);
  return { ...state, parsedValue };
};

export const useOptionalDistanceState = (): DistanceProps<true> => {
  const [rawValue, onUpdateRawValue] = useState("");
  const [unit, onChooseUnit] = useState<DistanceUnit>("m");
  const isValid = isValidDistance(unit, rawValue);
  const parsedValue =
    rawValue !== "" ? parseDistance(rawValue, unit) : undefined;
  return {
    rawValue,
    onUpdateRawValue,
    isValid,
    unit,
    onChooseUnit,
    parsedValue,
  };
};

{
  overlay = final: prev: {
    gradle-unwrapped = prev.gradle-unwrapped.override {
      java = prev.openjdk17;
      javaToolchains = [ prev.openjdk17 ];
    };
  };
}

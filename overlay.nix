{ inputs }:
final: prev:
let
  mkGradle = { jdk11, jdk17, jdk21 }:

rec {
  gen =

      { version, hash,

        # The default JDK/JRE that will be used for derived Gradle packages.
        # A current LTS version of a JDK is a good choice.
        defaultJava,

        # The platforms supported by this Gradle package.
        # Gradle Native-Platform ships some binaries that
        # are compatible only with specific platforms.
        # As of 2022-04 this affects platform compatibility
        # of multiple Gradle releases, so this is used as default.
        # See https://github.com/gradle/native-platform#supported-platforms
        platforms ? [
          "aarch64-darwin"
          "aarch64-linux"
          "i686-windows"
          "x86_64-cygwin"
          "x86_64-darwin"
          "x86_64-linux"
          "x86_64-windows"
        ]
      }:

      { lib
      , stdenv
      , fetchurl
      , makeWrapper
      , unzip
      , ncurses5
      , ncurses6
      , testers
      , runCommand
      , writeText
      , autoPatchelfHook

      # The JDK/JRE used for running Gradle.
      , java ? defaultJava

      # Additional JDK/JREs to be registered as toolchains.
      # See https://docs.gradle.org/current/userguide/toolchains.html
      , javaToolchains ? [ ]
      }:

      stdenv.mkDerivation (finalAttrs: {
        pname = "gradle";
        inherit version;

        src = fetchurl {
          inherit hash;
          url =
            "https://services.gradle.org/distributions/gradle-${version}-bin.zip";
        };

        dontBuild = true;

        nativeBuildInputs = [
          makeWrapper
          unzip
        ] ++ lib.optionals stdenv.hostPlatform.isLinux [
          autoPatchelfHook
        ];

        buildInputs = [
          java
          stdenv.cc.cc
          ncurses5
          ncurses6
        ];

        # We only need to patchelf some libs embedded in JARs.
        dontAutoPatchelf = true;

        installPhase = with builtins;
          let
            toolchain = rec {
              prefix = x: "JAVA_TOOLCHAIN_NIX_${toString x}";
              varDefs  = (lib.imap0 (i: x: "${prefix i} ${x}") javaToolchains);
              varNames = lib.imap0 (i: x: prefix i) javaToolchains;
              property = " -Porg.gradle.java.installations.fromEnv='${
                   concatStringsSep "," varNames
                 }'";
            };
            varDefs = concatStringsSep "\n" (map (x: "  --set ${x} \\")
              ([ "JAVA_HOME ${java}" ] ++ toolchain.varDefs));
          in ''
            mkdir -pv $out/lib/gradle/
            cp -rv lib/ $out/lib/gradle/

            gradle_launcher_jar=$(echo $out/lib/gradle/lib/gradle-launcher-*.jar)
            test -f $gradle_launcher_jar
            makeWrapper ${java}/bin/java $out/bin/gradle \
              ${varDefs}
              --add-flags "-classpath $gradle_launcher_jar org.gradle.launcher.GradleMain${toolchain.property}"
          '';

        dontFixup = !stdenv.hostPlatform.isLinux;

        fixupPhase = let arch = if stdenv.hostPlatform.is64bit then "amd64" else "i386";
        in ''
          . ${./patching.sh}

          nativeVersion="$(extractVersion native-platform $out/lib/gradle/lib/native-platform-*.jar)"
          for variant in "" "-ncurses5" "-ncurses6"; do
            autoPatchelfInJar \
              $out/lib/gradle/lib/native-platform-linux-${arch}$variant-''${nativeVersion}.jar \
              "${stdenv.cc.cc.lib}/lib64:${lib.makeLibraryPath [ stdenv.cc.cc ncurses5 ncurses6 ]}"
          done

          # The file-events library _seems_ to follow the native-platform version, but
          # we won’t assume that.
          fileEventsVersion="$(extractVersion file-events $out/lib/gradle/lib/file-events-*.jar)"
          autoPatchelfInJar \
            $out/lib/gradle/lib/file-events-linux-${arch}-''${fileEventsVersion}.jar \
            "${stdenv.cc.cc.lib}/lib64:${lib.makeLibraryPath [ stdenv.cc.cc ]}"

          # The scanner doesn't pick up the runtime dependency in the jar.
          # Manually add a reference where it will be found.
          mkdir $out/nix-support
          echo ${stdenv.cc.cc} > $out/nix-support/manual-runtime-dependencies
          # Gradle will refuse to start without _both_ 5 and 6 versions of ncurses.
          echo ${ncurses5} >> $out/nix-support/manual-runtime-dependencies
          echo ${ncurses6} >> $out/nix-support/manual-runtime-dependencies
        '';

        passthru.tests = {
          version = testers.testVersion {
            package = finalAttrs.finalPackage;
            command = ''
              env GRADLE_USER_HOME=$TMPDIR/gradle org.gradle.native.dir=$TMPDIR/native \
                gradle --version
            '';
          };

          java-application = testers.testEqualContents {
            assertion = "can build and run a trivial Java application";
            expected = writeText "expected" "hello\n";
            actual = runCommand "actual" {
              nativeBuildInputs = [ finalAttrs.finalPackage ];
              src = ./tests/java-application;
            } ''
              cp -a $src/* .
              env GRADLE_USER_HOME=$TMPDIR/gradle org.gradle.native.dir=$TMPDIR/native \
                gradle run --no-daemon --quiet --console plain > $out
            '';
          };
        };
        passthru.jdk = defaultJava;

        meta = with lib; {
          inherit platforms;
          description = "Enterprise-grade build system";
          longDescription = ''
            Gradle is a build system which offers you ease, power and freedom.
            You can choose the balance for yourself. It has powerful multi-project
            build support. It has a layer on top of Ivy that provides a
            build-by-convention integration for Ivy. It gives you always the choice
            between the flexibility of Ant and the convenience of a
            build-by-convention behavior.
          '';
          homepage = "https://www.gradle.org/";
          changelog = "https://docs.gradle.org/${version}/release-notes.html";
          downloadPage = "https://gradle.org/next-steps/?version=${version}";
          sourceProvenance = with sourceTypes; [
            binaryBytecode
            binaryNativeCode
          ];
          license = licenses.asl20;
          maintainers = with maintainers; [ lorenzleutgeb liff ];
          mainProgram = "gradle";
        };
      });

    # NOTE: Default JDKs that are hardcoded below must be LTS versions
    # and respect the compatibility matrix at
    # https://docs.gradle.org/current/userguide/compatibility.html

    gradle_8 = gen {
      version = "8.8";
      hash = "sha256-W5xes/n8LJSrrqV9kL14dHyhF927+WyFnTdBGBoSvo=";
      defaultJava = jdk21;
    };

    gradle_7 = gen {
      version = "7.6.4";
      hash = "sha256-vtHaM8yg9VerE2kcd/OLtnOIEZ5HlNET4FEDm4Cvm7E=";
      defaultJava = jdk17;
    };

    gradle_6 = gen {
      version = "6.9.4";
      hash = "sha256-PiQCKFON6fGHcqV06ZoLqVnoPW7zUQFDgazZYxeBOJo=";
      defaultJava = jdk11;
    };

    wrapGradle = {
        lib, callPackage, mitm-cache, substituteAll, symlinkJoin, concatTextFile, makeSetupHook
      }:
      gradle-unwrapped:
      lib.makeOverridable (args:
      let
        gradle = gradle-unwrapped.override args;
      in symlinkJoin {
        name = "gradle-${gradle.version}";

        paths = [
          (makeSetupHook { name = "gradle-setup-hook"; } (concatTextFile {
            name = "setup-hook.sh";
            files = [
              (mitm-cache.setupHook)
              (substituteAll {
                src = ./setup-hook.sh;
                # jdk used for keytool
                inherit (gradle) jdk;
                init_script = ./init-build.gradle;
              })
            ];
          }))
          gradle
          mitm-cache
        ];

        passthru = {
          fetchDeps = callPackage ./fetch-deps.nix { inherit mitm-cache; };
          inherit (gradle) jdk;
          unwrapped = gradle;
        };

        meta = gradle.meta // {
          # prefer normal gradle/mitm-cache over this wrapper, this wrapper only provides the setup hook
          # and passthru
          priority = (gradle.meta.priority or lib.meta.defaultPriority) + 1;
        };
      }) { };
  };

  overlay = (hsSelf: hsSuper: {
     jsaddle-warp = final.haskell.lib.compose.unmarkBroken hsSuper.jsaddle-warp;
 #    ekg = final.haskell.lib.compose.doJailbreak (final.haskell.lib.compose.unmarkBroken hsSuper.ekg);
     ekg-json =  (final.haskell.lib.compose.unmarkBroken hsSuper.ekg-json);
 #    ekg-json = final.haskell.lib.compose.doJailbreak (final.haskell.lib.compose.unmarkBroken (final.haskell.lib.compose.overrideSrc { src = final.fetchFromGitHub { owner = "L0neGamer"; repo = "ekg-json"; 
 #     rev = "b56408fab35642b27b874cf17a522e6ff5154bd6";
 #     sha256 = "sha256-OYXMEVfw0CG1tUsjJWF2BSkItR8Z/lHH4IdB44/mduE=";

 #  }  ; } hsSuper.ekg-json));
     stopwatch = final.haskell.lib.compose.doJailbreak (final.haskell.lib.compose.unmarkBroken hsSuper.stopwatch);
     servant-foreign = (final.haskell.lib.compose.overrideSrc { src = inputs.servant-foreign ; } hsSuper.servant-foreign);
     servant-typescript = final.haskell.lib.compose.doJailbreak (final.haskell.lib.compose.unmarkBroken (final.haskell.lib.compose.overrideSrc { src = ./tmp/servant-typescript ; } hsSuper.servant-typescript));
     aeson-typescript = (final.haskell.lib.compose.overrideSrc { src = ./tmp/aeson-typescript ; } hsSuper.aeson-typescript);
     #wkt-geom = 
       #final.haskell.lib.compose.doJailbreak (final.haskell.lib.compose.unmarkBroken (final.haskell.lib.compose.overrideSrc { src = inputs.my-wkt-geom ; } hsSuper.wkt-geom));

  });
in {
  haskellPackages = prev.haskellPackages.extend overlay;
  librttopo = prev.librttopo.overrideAttrs({
    nativeBuildInputs = with final; [ autoreconfHook validatePkgConfig ];
  });

  # keep a watch: this is from a current PR, it might be merged rsn
  gettext = if final.stdenv.hostPlatform == final.stdenv.buildPlatform then prev.gettext else prev.gettext.overrideAttrs( { 
    makeFlags = [ "CFLAGS=-D_FORTIFY_SOURCE=0" "CFLAGS=-D__USE_FORTIFY_LEVEL=0" ] ;
    postPatch = 
  ''
   substituteAllInPlace gettext-runtime/src/gettext.sh.in
   substituteInPlace gettext-tools/projects/KDE/trigger --replace "/bin/pwd" pwd
   substituteInPlace gettext-tools/projects/GNOME/trigger --replace "/bin/pwd" pwd
   substituteInPlace gettext-tools/src/project-id --replace "/bin/pwd" pwd
  '' + final.lib.optionalString final.stdenv.hostPlatform.isCygwin ''
    sed -i -e "s/\(cldr_plurals_LDADD = \)/\\1..\/gnulib-lib\/libxml_rpl.la /" gettext-tools/src/Makefile.in
    sed -i -e "s/\(libgettextsrc_la_LDFLAGS = \)/\\1..\/gnulib-lib\/libxml_rpl.la /" gettext-tools/src/Makefile.in
  '' + final.lib.optionalString final.stdenv.hostPlatform.isMinGW ''
    sed -i "s/@GNULIB_CLOSE@/1/" */*/unistd.in.h
  ''
    # An accidental inclusion in https://marc.info/?l=glibc-alpha&m=150511271003225&w=2
    # resulted in a getcwd prototype to be added in when it isn't needed.
    # Clang does not like this unless the "overridable" attribute was appied.
    # Since we don't need to redeclare getcwd, we can just remove it.
    #
    # Issue: https://github.com/NixOS/nixpkgs/issues/348658
    + final.lib.optionalString (final.stdenv.cc.isClang && !final.stdenv.targetPlatform.isDarwin) ''
    substituteInPlace gettext-runtime/intl/dcigettext.c --replace-fail "char *getcwd ();" ""
  ''
  ; });
  libunistring = if final.stdenv.hostPlatform == final.stdenv.buildPlatform then prev.libunistring else prev.libunistring.overrideAttrs( { 
    makeFlags = [ "CFLAGS=-D_FORTIFY_SOURCE=0" "CFLAGS=-D__USE_FORTIFY_LEVEL=0" ] ;
   });
  libiconv = if final.stdenv.hostPlatform == final.stdenv.buildPlatform then prev.libiconv else prev.libiconv.overrideAttrs( { 
    makeFlags = [ "CFLAGS=-D_FORTIFY_SOURCE=0" "CFLAGS=-D__USE_FORTIFY_LEVEL=0" ] ;
   });
  proj = if final.stdenv.hostPlatform == final.stdenv.buildPlatform then prev.proj else prev.proj.overrideAttrs( old: { 
    cmakeFlags = old.cmakeFlags ++ ["-DENABLE_TIFF=OFF" "-DENABLE_CURL=OFF" "-DBUILD_APPS=OFF" "-DCMAKE_BUILD_TYPE=Release"];
    makeFlags = [ "CFLAGS=-D_FORTIFY_SOURCE=0" "CFLAGS=-D__USE_FORTIFY_LEVEL=0" ] ;
      configureFlags =  [ "--help" ];
      buildInputs = with final; [
      #geos
      #librttopo
      #(libxml2.override { enableHttp = true; })
      #minizip
      #proj
      sqlite
      nlohmann_json
      #zlib
      #libunistring # needed on android
    ] ++ final.lib.optionals final.stdenv.hostPlatform.isDarwin [
      #final.libiconv
    ];
  });
  libspatialite = if final.stdenv.hostPlatform == final.stdenv.buildPlatform then prev.libspatialite else prev.libspatialite.overrideAttrs( old: { 
    postPatch = final.lib.optionalString (final.stdenv.hostPlatform != final.stdenv.buildPlatform) ''
      find -iname '*.c' -exec sed -i -e s:'#include .localcharset.h.':'#include <unistring/localcharset.h>':g '{}' ';' 
      sed -i -e 's:-lpthread:-lunistring -llog:g' src/Makefile.am src/Makefile.in test/Makefile.am configure configure.ac 
      ''; 
      src = inputs.libspatialite;
      SQLITE3_CFLAGS="-I${inputs.libspatialite}/exposqlite";
      CFLAGS="-I${inputs.libspatialite}/exposqlite";
      SQLITE3_LIBS=" ";
    makeFlags = [ "CFLAGS=-D_FORTIFY_SOURCE=0" "CFLAGS=-I${inputs.libspatialite}/exposqlite" "CFLAGS=-D__USE_FORTIFY_LEVEL=0" "CFLAGS=-I${final.libunistring.dev}/include" "CFLAGS=-Wno-implicit-function-declaration" ] ;
      configureFlags =  [ "--enable-examples=no" "--enable-libxml2=no" "--enable-rttopo=no" "--enable-minizip=no" "--disable-gcp" "--enable-freexl=no" "--with-geosconfig=${final.geos}/bin/geos-config" ];
      buildInputs = with final; [
      geos
      #librttopo
      #(libxml2.override { enableHttp = true; })
      #minizip
      proj
      #sqlite
      #zlib
      libunistring # needed on android
    ] ++ final.lib.optionals final.stdenv.hostPlatform.isDarwin [
      final.libiconv
    ];
  });
  gradle_8_8 = final.wrapGradle (prev.gradle_8.overrideAttrs ( rec {
    version = "8.8";
    hash = "sha256-pLQVhgH4Y2ze6rCb12r7ZAAwu1sUSq/iYaXorwJ9xhI=";
    src = prev.fetchurl {
          inherit hash;
          url =
            "https://services.gradle.org/distributions/gradle-8.8-bin.zip";
        };
  } ));
  inherit (inputs.self.packages.${final.system}) android-sdk;
}

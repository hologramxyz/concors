import { Image, View } from "react-native";
import { useTheme } from "./ui";

/** Match desktop's branded startup instead of flashing sign-in during session restoration. */
export function StartupScreen() {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Opening Concors"
      accessibilityState={{ busy: true }}
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.background,
      }}
    >
      <Image
        source={require("../assets/splash.png")}
        accessible={false}
        style={{ width: 160, height: 160, tintColor: theme.text }}
      />
    </View>
  );
}

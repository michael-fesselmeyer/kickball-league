import Capacitor
import UIKit

/// The iOS app's web view controller, which registers the app's own
/// plugins (ADR 0075). Set it as the custom class of the view controller in
/// ios/App/App/Base.lproj/Main.storyboard (docs/mobile.md).
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(WebAuthSessionPlugin())
    }
}

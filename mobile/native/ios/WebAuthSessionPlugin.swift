import AuthenticationServices
import Capacitor

/// Google sign-in for the iOS app through the system sign-in sheet
/// (ASWebAuthenticationSession), never the app's own web view, which Google
/// refuses (ADR 0077). The page calls `Capacitor.Plugins.WebAuthSession
/// .start({ url, callbackScheme })` and gets back the address the sheet
/// ended on, which carries a one-time code for this app only.
///
/// Copy this file and MainViewController.swift into ios/App/App and set the
/// storyboard's view controller to MainViewController (docs/mobile.md).
@objc(WebAuthSessionPlugin)
public class WebAuthSessionPlugin: CAPPlugin, CAPBridgedPlugin,
    ASWebAuthenticationPresentationContextProviding
{
    public let identifier = "WebAuthSessionPlugin"
    public let jsName = "WebAuthSession"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise)
    ]

    /// Held while the sheet is up; the system releases an unreferenced one.
    private var session: ASWebAuthenticationSession?

    @objc func start(_ call: CAPPluginCall) {
        guard
            let address = call.getString("url"),
            let url = URL(string: address),
            url.scheme == "https" || url.host == "localhost",
            let scheme = call.getString("callbackScheme"), !scheme.isEmpty
        else {
            call.reject("A sign-in address and the app's scheme are needed.")
            return
        }
        DispatchQueue.main.async {
            let session = ASWebAuthenticationSession(
                url: url, callbackURLScheme: scheme
            ) { [weak self] callback, error in
                self?.session = nil
                if let callback {
                    call.resolve(["url": callback.absoluteString])
                } else if let error = error as? ASWebAuthenticationSessionError,
                    error.code == .canceledLogin
                {
                    call.reject("Sign-in was cancelled.", "CANCELLED")
                } else {
                    call.reject(error?.localizedDescription ?? "Sign-in failed.")
                }
            }
            session.presentationContextProvider = self
            // Shares Safari's Google sign-in, so most people only pick an
            // account. The league's own session in the sheet is signed out
            // again before the sheet returns.
            session.prefersEphemeralWebBrowserSession = false
            self.session = session
            if !session.start() {
                self.session = nil
                call.reject("The sign-in sheet couldn't open.")
            }
        }
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession)
        -> ASPresentationAnchor
    {
        return bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }
}

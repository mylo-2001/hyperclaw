//
//  NodeCommands.swift
//  HyperClaw
//
//  iOS node depth: SMS, Contacts, Calendar, Motion.
//  Mirrors Android NodeCommands.kt — brings iOS to OpenClaw-level node parity.
//
//  Usage: call via gateway node.invoke messages:
//    { "type": "node:invoke", "command": "sms.list", "params": { "limit": 20 } }
//    { "type": "node:invoke", "command": "contacts.list" }
//    { "type": "node:invoke", "command": "calendar.events", "params": { "daysAhead": 7 } }
//    { "type": "node:invoke", "command": "motion.sample" }
//

import Foundation
import Contacts
import EventKit
import CoreMotion
import MessageUI

// MARK: - NodeCommandResult

struct NodeCommandResult {
    let ok: Bool
    let json: String
    let error: String?

    static func success(_ json: String) -> NodeCommandResult { .init(ok: true, json: json, error: nil) }
    static func failure(_ message: String) -> NodeCommandResult { .init(ok: false, json: "null", error: message) }
}

// MARK: - NodeCommands

@MainActor
class NodeCommands: NSObject {

    static let shared = NodeCommands()

    private let eventStore = EKEventStore()
    private let contactStore = CNContactStore()
    private let motionManager = CMMotionManager()

    // ─── Dispatch ──────────────────────────────────────────────────────────────

    func invoke(command: String, params: [String: Any]) async -> NodeCommandResult {
        switch command {
        case "sms.list":
            let limit = params["limit"] as? Int ?? 20
            return await smsList(limit: limit)
        case "sms.send":
            guard let to = params["to"] as? String, let body = params["body"] as? String else {
                return .failure("sms.send requires 'to' and 'body'")
            }
            return await smsSend(to: to, body: body)
        case "contacts.list":
            let limit = params["limit"] as? Int ?? 50
            return await contactsList(limit: limit)
        case "contacts.search":
            let query = params["query"] as? String ?? ""
            return await contactsSearch(query: query)
        case "calendar.events":
            let daysAhead = params["daysAhead"] as? Int ?? 7
            return await calendarEvents(daysAhead: daysAhead)
        case "calendar.create":
            guard let title = params["title"] as? String else {
                return .failure("calendar.create requires 'title'")
            }
            let start = params["startDate"] as? Double ?? Date().timeIntervalSince1970
            let end = params["endDate"] as? Double ?? start + 3600
            let notes = params["notes"] as? String
            return await calendarCreate(title: title, start: start, end: end, notes: notes)
        case "motion.sample":
            return await motionSample()
        default:
            return .failure("Unknown command: \(command)")
        }
    }

    // ─── SMS ──────────────────────────────────────────────────────────────────

    private func smsList(limit: Int) async -> NodeCommandResult {
        // iOS does not expose an SMS inbox read API in sandboxed apps.
        // Best effort: return a clear explanation so the agent understands.
        return .failure("sms.list is not available on iOS due to sandbox restrictions. " +
                        "Use the Android node for SMS read access, or integrate via iMessage (BlueBubbles).")
    }

    @MainActor
    func smsSend(to: String, body: String) async -> NodeCommandResult {
        guard MFMessageComposeViewController.canSendText() else {
            return .failure("SMS not available on this device")
        }
        // SMS sending on iOS requires UI interaction (MFMessageComposeViewController).
        // Signal the gateway to open the compose UI via the registered callback.
        SMSSendRequest.pending = SMSSendRequest(to: to, body: body)
        NotificationCenter.default.post(name: .hyperclaw_smsSend, object: nil)
        return .success("{\"status\": \"compose_opened\", \"to\": \"\(to)\"}")
    }

    // ─── Contacts ─────────────────────────────────────────────────────────────

    private func contactsList(limit: Int) async -> NodeCommandResult {
        let status = CNContactStore.authorizationStatus(for: .contacts)
        if status == .denied || status == .restricted {
            return .failure("Contacts permission denied. Grant in Settings → Privacy → Contacts.")
        }
        if status == .notDetermined {
            let granted = await requestContactsAccess()
            if !granted { return .failure("Contacts permission not granted") }
        }
        do {
            let keys = [CNContactGivenNameKey, CNContactFamilyNameKey, CNContactPhoneNumbersKey, CNContactEmailAddressesKey] as [CNKeyDescriptor]
            let request = CNFetchRequest(entityType: .contacts)
            request.keysToFetch = keys
            var results: [[String: Any]] = []
            try contactStore.enumerateContacts(with: request) { contact, stop in
                let name = [contact.givenName, contact.familyName].filter { !$0.isEmpty }.joined(separator: " ")
                let phones = contact.phoneNumbers.map { $0.value.stringValue }
                let emails = contact.emailAddresses.map { $0.value as String }
                results.append([
                    "name": name,
                    "phones": phones,
                    "emails": emails
                ])
                if results.count >= limit { stop.pointee = true }
            }
            let data = try JSONSerialization.data(withJSONObject: results)
            return .success(String(data: data, encoding: .utf8) ?? "[]")
        } catch {
            return .failure("Contacts error: \(error.localizedDescription)")
        }
    }

    private func contactsSearch(query: String) async -> NodeCommandResult {
        let status = CNContactStore.authorizationStatus(for: .contacts)
        if status == .denied || status == .restricted {
            return .failure("Contacts permission denied")
        }
        if status == .notDetermined {
            let granted = await requestContactsAccess()
            if !granted { return .failure("Contacts permission not granted") }
        }
        do {
            let keys = [CNContactGivenNameKey, CNContactFamilyNameKey, CNContactPhoneNumbersKey, CNContactEmailAddressesKey] as [CNKeyDescriptor]
            let predicate = CNContact.predicateForContacts(matchingName: query)
            let contacts = try contactStore.unifiedContacts(matching: predicate, keysToFetch: keys)
            let results = contacts.map { contact -> [String: Any] in
                let name = [contact.givenName, contact.familyName].filter { !$0.isEmpty }.joined(separator: " ")
                return [
                    "name": name,
                    "phones": contact.phoneNumbers.map { $0.value.stringValue },
                    "emails": contact.emailAddresses.map { $0.value as String }
                ]
            }
            let data = try JSONSerialization.data(withJSONObject: results)
            return .success(String(data: data, encoding: .utf8) ?? "[]")
        } catch {
            return .failure("Contacts search error: \(error.localizedDescription)")
        }
    }

    private func requestContactsAccess() async -> Bool {
        await withCheckedContinuation { cont in
            contactStore.requestAccess(for: .contacts) { granted, _ in
                cont.resume(returning: granted)
            }
        }
    }

    // ─── Calendar ─────────────────────────────────────────────────────────────

    private func calendarEvents(daysAhead: Int) async -> NodeCommandResult {
        let status = EKEventStore.authorizationStatus(for: .event)
        if status == .denied || status == .restricted {
            return .failure("Calendar permission denied. Grant in Settings → Privacy → Calendar.")
        }
        if status == .notDetermined {
            let granted = await requestCalendarAccess()
            if !granted { return .failure("Calendar permission not granted") }
        }
        let now = Date()
        let end = Calendar.current.date(byAdding: .day, value: daysAhead, to: now) ?? now
        let predicate = eventStore.predicateForEvents(withStart: now, end: end, calendars: nil)
        let events = eventStore.events(matching: predicate).sorted { $0.startDate < $1.startDate }
        let results = events.map { event -> [String: Any] in
            [
                "title": event.title ?? "",
                "start": event.startDate.timeIntervalSince1970 * 1000,
                "end": event.endDate.timeIntervalSince1970 * 1000,
                "location": event.location ?? "",
                "notes": event.notes ?? "",
                "calendar": event.calendar?.title ?? "",
                "allDay": event.isAllDay
            ]
        }
        do {
            let data = try JSONSerialization.data(withJSONObject: results)
            return .success(String(data: data, encoding: .utf8) ?? "[]")
        } catch {
            return .failure("Calendar serialization error: \(error.localizedDescription)")
        }
    }

    private func calendarCreate(title: String, start: Double, end: Double, notes: String?) async -> NodeCommandResult {
        let status = EKEventStore.authorizationStatus(for: .event)
        if status == .denied || status == .restricted {
            return .failure("Calendar permission denied")
        }
        if status == .notDetermined {
            let granted = await requestCalendarAccess()
            if !granted { return .failure("Calendar permission not granted") }
        }
        let event = EKEvent(eventStore: eventStore)
        event.title = title
        event.startDate = Date(timeIntervalSince1970: start)
        event.endDate = Date(timeIntervalSince1970: end)
        event.notes = notes
        event.calendar = eventStore.defaultCalendarForNewEvents
        do {
            try eventStore.save(event, span: .thisEvent)
            return .success("{\"status\": \"created\", \"eventId\": \"\(event.eventIdentifier ?? "")\"}")
        } catch {
            return .failure("Calendar create error: \(error.localizedDescription)")
        }
    }

    private func requestCalendarAccess() async -> Bool {
        await withCheckedContinuation { cont in
            eventStore.requestAccess(to: .event) { granted, _ in
                cont.resume(returning: granted)
            }
        }
    }

    // ─── Motion ───────────────────────────────────────────────────────────────

    private func motionSample() async -> NodeCommandResult {
        guard motionManager.isAccelerometerAvailable else {
            return .failure("Accelerometer not available on this device")
        }
        return await withCheckedContinuation { cont in
            motionManager.accelerometerUpdateInterval = 0.1
            motionManager.startAccelerometerUpdates(to: .main) { [weak self] data, error in
                guard let self else { return }
                self.motionManager.stopAccelerometerUpdates()
                if let error {
                    cont.resume(returning: NodeCommandResult.failure("Motion error: \(error.localizedDescription)"))
                    return
                }
                guard let data else {
                    cont.resume(returning: NodeCommandResult.failure("No accelerometer data"))
                    return
                }
                let json = "{\"x\": \(data.acceleration.x), \"y\": \(data.acceleration.y), \"z\": \(data.acceleration.z)}"
                cont.resume(returning: NodeCommandResult.success(json))
            }
        }
    }
}

// MARK: - SMS Compose Request

struct SMSSendRequest {
    let to: String
    let body: String
    static var pending: SMSSendRequest?
}

extension Notification.Name {
    static let hyperclaw_smsSend = Notification.Name("hyperclaw_smsSend")
}

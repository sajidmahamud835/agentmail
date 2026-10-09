# Test-only fixture. Never run against a production database.
abort "Disposable CI database only" unless ENV["AGENTMAIL_CI"] == "true"

user = User.create!(first_name: "Test", last_name: "Operator", email_address: "operator@example.com",
                    password: SecureRandom.hex(32), email_verified_at: Time.now, admin: true)
organization = Organization.create!(name: "Test organization", owner: user)
server = Server.create!(organization: organization, name: "Test mail", mode: "Live")
domain = Domain.create!(owner: server, name: "inbound.example.com", verification_method: "DNS", verified_at: Time.now)
endpoint = HTTPEndpoint.create!(server: server, name: "Agent inbox", url: "http://127.0.0.1:8025/postal/inbound",
                                encoding: "BodyAsJSON", format: "Hash", include_attachments: true, timeout: 5)
Route.create!(server: server, domain: domain, name: "assistant", mode: "Endpoint", spam_mode: "Mark", endpoint: endpoint)
credential = Credential.create!(server: server, name: "Held test send", type: "API", hold: true)
puts "AGENTMAIL_TEST_KEY=#{credential.key}"

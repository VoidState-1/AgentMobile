package expo.modules.agentmobile.git

import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.ConcurrentHashMap
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory

internal class GitJob(private val progress: (String, Int, Int, Long) -> Unit) {
  @Volatile private var cancelled = false
  private val connections = ConcurrentHashMap.newKeySet<AndroidTlsConnection>()

  // Called synchronously by libgit2 on its native worker thread.
  fun onProgress(phase: String, completed: Int, total: Int, bytes: Long) { progress(phase, completed, total, bytes) }
  fun isCancelled(): Boolean = cancelled
  fun tls(host: String, port: Int): AndroidTlsConnection {
    check(!cancelled) { "CANCELLED" }
    val connection = AndroidTlsConnection(host, port) { connections.remove(it) }
    connections.add(connection)
    if (cancelled) { connection.close(); error("CANCELLED") }
    return connection
  }
  fun cancel() { cancelled = true; close() }
  fun close() { connections.toList().forEach { it.close() } }
}

/** Android's trust store and HTTPS hostname verification, with no permissive TrustManager. */
internal class AndroidTlsConnection(
  private val host: String,
  private val port: Int,
  private val disposed: (AndroidTlsConnection) -> Unit,
) {
  @Volatile private var socket: Socket? = null
  @Volatile private var closed = false
  fun connect() {
    val plain = Socket()
    synchronized(this) {
      check(!closed) { "Socket closed" }
      socket = plain
    }
    plain.connect(InetSocketAddress(host, port), 15_000)
    val tls = (SSLSocketFactory.getDefault() as SSLSocketFactory).createSocket(plain, host, port, true) as SSLSocket
    synchronized(this) {
      if (closed) { tls.close(); error("Socket closed") }
      socket = tls
    }
    tls.soTimeout = 15_000
    tls.sslParameters = tls.sslParameters.apply { endpointIdentificationAlgorithm = "HTTPS" }
    tls.startHandshake()
  }
  fun certificate(): ByteArray = (socket as SSLSocket).session.peerCertificates.first().encoded
  fun read(maximum: Int): ByteArray {
    val bytes = ByteArray(maximum)
    val count = checkNotNull(socket).getInputStream().read(bytes)
    return if (count < 0) ByteArray(0) else bytes.copyOf(count)
  }
  fun write(bytes: ByteArray): Int {
    checkNotNull(socket).getOutputStream().write(bytes)
    return bytes.size
  }
  fun close() {
    val current = synchronized(this) { closed = true; socket }
    try { current?.close() } catch (_: Exception) { /* Cancellation may close an already closed socket. */ }
    disposed(this)
  }
}

internal object NativeGit {
  init { System.loadLibrary("agent_mobile_git") }
  external fun version(): String
  external fun execute(root: String, request: ByteArray, callbacks: GitJob): ByteArray
  external fun run(root: String, phase: String, remote: String, callbacks: GitJob): ByteArray
}
